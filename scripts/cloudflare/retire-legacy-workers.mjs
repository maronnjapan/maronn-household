#!/usr/bin/env node
/**
 * 旧 Worker の退役
 *
 * 許可リスト（config.mjs の LEGACY_WORKERS）の Worker ごとに、この順で処理する:
 *   1. ゾーンの Workers ルートのうち、その Worker に割り当てられたものを削除する
 *   2. アカウントの Workers Custom Domains のうち、その Worker のものを外す
 *   3. Worker（スクリプト）を削除する（既に無ければ何もしない）
 * 許可リストにない Worker には一切触れない。何度実行しても同じ結果になる。
 */
import { clientFromEnv } from './cloudflare-api.mjs';
import { CURRENT_WORKERS, LEGACY_WORKERS, ZONE_NAME } from './config.mjs';
import { isMainModule, logError, parseCliArgs, runCli } from './cli-utils.mjs';

const USAGE = `使い方: node scripts/cloudflare/retire-legacy-workers.mjs [--dry-run]

旧 Worker（${LEGACY_WORKERS.join(', ')}）のルート（ゾーン ${ZONE_NAME}）と Custom Domain を外してから削除する。
  --dry-run   計画を表示するだけで何も変更しない

環境変数: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID`;

/** 退役させてよい名前か（許可リストにあり、現行の Worker ではない）を検査する */
export function assertRetirable(legacyNames) {
  for (const name of legacyNames) {
    if (!LEGACY_WORKERS.includes(name)) throw new Error(`${name} は退役の許可リストにありません`);
    if (CURRENT_WORKERS.includes(name)) throw new Error(`${name} は現行の Worker なので退役させられません`);
  }
}

/**
 * 退役の計画（純粋関数）
 * @param {{ id: string, pattern: string, script: string | null }[]} routes ゾーンのルート
 * @param {{ id: string, hostname: string, service: string }[]} domains アカウントの Custom Domains
 * @param {string[]} legacyNames 退役させる Worker（この順に処理する）
 * @returns {{ worker: string, operations: ({ type: 'delete-route', routeId: string, pattern: string } | { type: 'delete-domain', domainId: string, hostname: string } | { type: 'delete-script', script: string })[] }[]}
 */
export function planLegacyCleanup(routes, domains, legacyNames) {
  assertRetirable(legacyNames);
  return legacyNames.map((worker) => ({
    worker,
    operations: [
      ...routes
        .filter((route) => route.script === worker)
        .map((route) => ({ type: 'delete-route', routeId: route.id, pattern: route.pattern })),
      ...domains
        .filter((domain) => domain.service === worker)
        .map((domain) => ({ type: 'delete-domain', domainId: domain.id, hostname: domain.hostname })),
      { type: 'delete-script', script: worker },
    ],
  }));
}

export function describeOperation(operation) {
  switch (operation.type) {
    case 'delete-route':
      return `ルート ${operation.pattern} を削除`;
    case 'delete-domain':
      return `Custom Domain ${operation.hostname} を外す`;
    case 'delete-script':
      return `Worker ${operation.script} を削除`;
    default:
      throw new Error(`未知の操作: ${JSON.stringify(operation)}`);
  }
}

async function apply(client, zoneId, operation) {
  switch (operation.type) {
    case 'delete-route':
      await client.deleteRoute(zoneId, operation.routeId);
      return '削除しました';
    case 'delete-domain':
      await client.deleteWorkerDomain(operation.domainId);
      return '外しました';
    case 'delete-script':
      return (await client.deleteScript(operation.script)) === 'deleted' ? '削除しました' : '既にありません';
    default:
      throw new Error(`未知の操作: ${JSON.stringify(operation)}`);
  }
}

export async function main(argv) {
  const args = parseCliArgs(argv, { 'dry-run': { type: 'boolean' } });
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const client = clientFromEnv();

  // 計画に必要な情報を先にすべて読む。読めなければ何も変更せずに失敗する
  const zoneId = await client.getZoneId(ZONE_NAME);
  const routes = await client.listRoutes(zoneId);
  const domains = await client.listWorkerDomains();
  const plan = planLegacyCleanup(routes, domains, [...LEGACY_WORKERS]);

  for (const { worker, operations } of plan) {
    console.log(`[${worker}]`);
    for (const operation of operations) console.log(`  - ${describeOperation(operation)}`);
  }
  if (args['dry-run']) {
    console.log('--dry-run のため変更しません');
    return 0;
  }

  // 1 つの失敗で残りを止めない（とくに mcp-server は他の失敗に関係なく消したい）。最後にまとめて失敗にする
  const failures = [];
  for (const { worker, operations } of plan) {
    for (const operation of operations) {
      const label = `[${worker}] ${describeOperation(operation)}`;
      try {
        console.log(`${label}: ${await apply(client, zoneId, operation)}`);
      } catch (error) {
        failures.push(label);
        logError(`${label}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`旧 Worker の退役で ${failures.length} 件失敗しました: ${failures.join(' / ')}`);
  }
  console.log('旧 Worker の退役が完了しました');
  return 0;
}

if (isMainModule(import.meta.url)) await runCli(main);
