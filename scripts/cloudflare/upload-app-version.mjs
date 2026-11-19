#!/usr/bin/env node
/**
 * household-app の新しいバージョンをアップロードする（本番へは出さない）
 *
 * `vike build` のあとに apps/household-app で `wrangler versions upload` を実行する。
 * ビルドが書くリダイレクト設定（.wrangler/deploy/config.json → dist/server/wrangler.json）を wrangler が読むので、
 * ビルド結果がアップロードされる。バージョン ID は WRANGLER_OUTPUT_FILE_PATH の ND-JSON
 * （type: "version-upload" の version_id）から取り出し、ステップ出力 version_id に書く。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { APP_WORKER, WORKER_DIRS } from './config.mjs';
import { isMainModule, parseCliArgs, runCli, writeGithubOutput } from './cli-utils.mjs';
import { findUploadedVersionId, parseWranglerOutput, runWrangler } from './wrangler.mjs';

const USAGE = `使い方: node scripts/cloudflare/upload-app-version.mjs [--message <text>]

${WORKER_DIRS[APP_WORKER]} で wrangler versions upload を実行し、アップロードしたバージョン ID を表示する
（GitHub Actions ではステップ出力 version_id にも書く）。先に vike build を済ませておくこと。
環境変数: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID`;

/** バージョンのメッセージ（コミットが分かれば含める） */
export function versionMessage(env = process.env) {
  const sha = env.GITHUB_SHA ? env.GITHUB_SHA.slice(0, 12) : 'local';
  return `deploy ${sha}`;
}

export async function main(argv) {
  const args = parseCliArgs(argv, { message: { type: 'string' } });
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const outputDir = mkdtempSync(path.join(process.env.RUNNER_TEMP || tmpdir(), 'wrangler-output-'));
  const outputFile = path.join(outputDir, 'versions-upload.ndjson');
  try {
    runWrangler(['versions', 'upload', '--message', args.message ?? versionMessage()], {
      appDir: WORKER_DIRS[APP_WORKER],
      env: { WRANGLER_OUTPUT_FILE_PATH: outputFile },
    });
    const versionId = findUploadedVersionId(parseWranglerOutput(readFileSync(outputFile, 'utf8')), APP_WORKER);
    console.log(`${APP_WORKER} のバージョン ${versionId} をアップロードしました（まだ本番には出ていません）`);
    writeGithubOutput('version_id', versionId);
    return 0;
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

if (isMainModule(import.meta.url)) await runCli(main);
