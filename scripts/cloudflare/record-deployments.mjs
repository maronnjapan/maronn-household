#!/usr/bin/env node
/**
 * デプロイ前の記録
 *
 * household-auth / household-mcp / household-gateway（wrangler deploy で即時に 100% になる）と household-app の
 * 現在のデプロイ（バージョンの配分）を、本番を変更する前に状態ファイルに書く。
 * 以降のステップが失敗したら、rollback.mjs がここに記録したデプロイへ戻す。
 * まだ無い Worker（初回のデプロイ）は「戻す先なし」と記録する。
 */
import { existsSync, readFileSync } from 'node:fs';
import { clientFromEnv, normalizeDeployment } from './cloudflare-api.mjs';
import { RECORDED_WORKERS } from './config.mjs';
import { isMainModule, parseCliArgs, runCli, writeJsonFileAtomic } from './cli-utils.mjs';

export const WORKERS_STATE_SCHEMA = 1;

const USAGE = `使い方: node scripts/cloudflare/record-deployments.mjs --state <file>

${RECORDED_WORKERS.join(', ')} の現在のデプロイを <file> に記録する（何も変更しない）。
失敗時は node scripts/cloudflare/rollback.mjs --workers-state <file> ... がここへ戻す。
環境変数: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID`;

/**
 * 状態ファイルの内容（純粋関数）
 * @param {Record<string, { scriptExists: boolean, deployment: { id: string | null, versions: { version_id: string, percentage: number }[] } | null }>} snapshots
 */
export function buildWorkersState(snapshots, now = new Date()) {
  return { schema: WORKERS_STATE_SCHEMA, createdAt: now.toISOString(), workers: snapshots };
}

/** 状態ファイルの内容を検証する（純粋関数） */
export function parseWorkersState(state) {
  if (state?.schema !== WORKERS_STATE_SCHEMA) throw new Error(`Worker の状態ファイルの形式が違います（schema ${state?.schema}）`);
  if (!state.workers || typeof state.workers !== 'object') throw new Error('Worker の状態ファイルに workers がありません');
  const workers = {};
  for (const [worker, record] of Object.entries(state.workers)) {
    if (typeof record?.scriptExists !== 'boolean') throw new Error(`${worker} の記録が不正です`);
    workers[worker] = {
      scriptExists: record.scriptExists,
      deployment: record.deployment === null ? null : normalizeDeployment(record.deployment),
    };
  }
  return { ...state, workers };
}

export function readWorkersState(file) {
  return parseWorkersState(JSON.parse(readFileSync(file, 'utf8')));
}

export function describeSnapshot({ scriptExists, deployment }) {
  if (!scriptExists) return '（まだ無い。戻す先なし）';
  if (!deployment) return '（デプロイなし。戻す先なし）';
  return deployment.versions.map((v) => `${v.version_id}@${v.percentage}%`).join(', ');
}

export async function main(argv) {
  const args = parseCliArgs(argv, { state: { type: 'string' } });
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.state) throw new Error(`--state が必要です\n\n${USAGE}`);
  if (existsSync(args.state)) {
    throw new Error(`状態ファイル ${args.state} が既にあります。前回の記録を上書きしないよう中止します`);
  }

  const client = clientFromEnv();
  const snapshots = {};
  for (const worker of RECORDED_WORKERS) {
    snapshots[worker] = await client.getCurrentDeployment(worker);
    console.log(`${worker}: ${describeSnapshot(snapshots[worker])}`);
  }
  writeJsonFileAtomic(args.state, buildWorkersState(snapshots));
  console.log(`デプロイ前の状態を ${args.state} に記録しました`);
  return 0;
}

if (isMainModule(import.meta.url)) await runCli(main);
