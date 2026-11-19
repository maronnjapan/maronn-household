/**
 * wrangler（各アプリの node_modules にある 4.x）の呼び出しと、その出力の解釈
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './config.mjs';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** アプリのディレクトリ（リポジトリのルートからの相対パスか絶対パス）にある wrangler の実行ファイル */
export function wranglerBinary(appDir) {
  return path.join(path.resolve(REPO_ROOT, appDir), 'node_modules', '.bin', 'wrangler');
}

/**
 * wrangler を実行する。失敗（終了コード 0 以外）は例外にする。
 * `input` は標準入力に渡す（secret の値はコマンドライン引数にもログにも出さない）。
 */
export function runWrangler(args, { appDir, input, env = {} }) {
  const cwd = path.resolve(REPO_ROOT, appDir);
  const binary = wranglerBinary(appDir);
  if (!existsSync(binary)) {
    throw new Error(`wrangler が見つかりません: ${binary}（先に pnpm install を実行してください）`);
  }
  const result = spawnSync(binary, args, {
    cwd,
    input,
    env: { ...process.env, ...env },
    stdio: [input === undefined ? 'ignore' : 'pipe', 'inherit', 'inherit'],
    encoding: 'utf8',
  });
  if (result.error) throw new Error(`wrangler を起動できません: ${result.error.message}`);
  if (result.status !== 0) {
    // 引数には secret の値を入れないので、そのまま表示してよい
    throw new Error(`wrangler ${args.join(' ')} が失敗しました（終了コード ${result.status}、${cwd}）`);
  }
}

/** WRANGLER_OUTPUT_FILE_PATH に書かれる ND-JSON（1 行 1 エントリ）を読む */
export function parseWranglerOutput(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`wrangler の出力ファイルの ${index + 1} 行目が JSON ではありません`);
      }
    });
}

/** `wrangler versions upload` の出力（type: "version-upload"）からアップロードしたバージョン ID を取り出す */
export function findUploadedVersionId(entries, workerName) {
  const failed = entries.find((e) => e?.type === 'command-failed');
  if (failed) throw new Error(`wrangler versions upload が失敗しました: ${failed.message ?? failed.code ?? '不明'}`);
  const uploads = entries.filter((e) => e?.type === 'version-upload');
  if (uploads.length !== 1) {
    throw new Error(`wrangler の出力に version-upload がちょうど 1 件ありません（${uploads.length} 件）`);
  }
  const [upload] = uploads;
  if (upload.worker_name !== workerName) {
    throw new Error(`アップロード先の Worker が ${workerName} ではありません: ${upload.worker_name}`);
  }
  if (typeof upload.version_id !== 'string' || !UUID_PATTERN.test(upload.version_id)) {
    throw new Error(`アップロードしたバージョン ID が不正です: ${upload.version_id}`);
  }
  return upload.version_id;
}
