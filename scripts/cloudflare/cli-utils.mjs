/**
 * スクリプト共通の CLI 補助（引数・GitHub Actions のワークフローコマンド・終了コード）
 */
import { appendFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const inGithubActions = () => process.env.GITHUB_ACTIONS === 'true';

/** このモジュールが `node <file>` で直接実行されたか（テストからの import では false） */
export function isMainModule(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(path.resolve(entry));
  } catch {
    return false;
  }
}

/** node:util の parseArgs（未知の引数はエラー） */
export function parseCliArgs(argv, options) {
  return parseArgs({ args: argv, options: { help: { type: 'boolean', short: 'h' }, ...options }, strict: true })
    .values;
}

/** ワークフローコマンドのメッセージ部分のエスケープ（https://github.com/actions/toolkit/blob/main/packages/core/src/command.ts） */
export function escapeWorkflowData(text) {
  return String(text).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

export function logError(message) {
  if (inGithubActions()) {
    console.log(`::error::${escapeWorkflowData(message)}`);
  }
  console.error(`ERROR: ${message}`);
}

export function logWarning(message) {
  if (inGithubActions()) {
    console.log(`::warning::${escapeWorkflowData(message)}`);
  } else {
    console.warn(`WARNING: ${message}`);
  }
}

/**
 * 生成した秘密の値をログに出さないよう GitHub Actions に登録する。
 * Actions の外では何も出力しない（`::add-mask::` の行そのものが値を表示してしまうため）
 */
export function maskSecret(value) {
  if (inGithubActions() && value) {
    console.log(`::add-mask::${escapeWorkflowData(value)}`);
  }
}

/** ステップの出力（`steps.<id>.outputs.<name>`）を書く。Actions の外では何もしない */
export function writeGithubOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  if (/[\r\n]/.test(value)) throw new Error(`GITHUB_OUTPUT の値 ${name} に改行は使えません`);
  appendFileSync(file, `${name}=${value}\n`);
}

/** main(argv) を実行し、戻り値（既定 0）を終了コードにする。例外はメッセージだけ出して 1 で終わる */
export async function runCli(main) {
  try {
    process.exitCode = (await main(process.argv.slice(2))) ?? 0;
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    if (process.env.DEPLOY_SCRIPTS_DEBUG === '1' && error instanceof Error) console.error(error.stack);
    process.exitCode = 1;
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 途中で止まっても壊れたファイルが残らないよう、一時ファイルに書いてから置き換える */
export function writeJsonFileAtomic(file, value) {
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}
