#!/usr/bin/env node
/**
 * カットオーバー
 *
 * カットオーバー（--state <file> --app-version <id>）:
 *   1. 変更の前に、ルートの割り当てと household-app の現在のデプロイを状態ファイルに記録する
 *   2. ルート（maronn-household-budget.com/* と www.…/*）を household-gateway に割り当てる。
 *      同じパターンのルートがあれば PUT で割り当て先だけを変え（未割り当ての時間ができない）、無ければ POST で作る
 *   3. `wrangler versions deploy <id>@100% --name household-app --yes` で household-app の新バージョンを本番に出す
 *
 * 戻すのは rollback.mjs（この状態ファイルと record-deployments.mjs の記録を読む）
 */
import { existsSync, readFileSync } from 'node:fs';
import { clientFromEnv } from './cloudflare-api.mjs';
import {
  APP_WORKER,
  AUTH_WORKER,
  GATEWAY_WORKER,
  MCP_WORKER,
  ROUTE_PATTERNS,
  WORKER_DIRS,
  ZONE_NAME,
} from './config.mjs';
import { isMainModule, logWarning, parseCliArgs, runCli, writeJsonFileAtomic } from './cli-utils.mjs';
import { UUID_PATTERN, runWrangler } from './wrangler.mjs';

export const STATE_SCHEMA = 1;

const USAGE = `使い方:
  node scripts/cloudflare/cutover-routes.mjs --state <file> --app-version <version-id> [--dry-run]
      ルート（${ROUTE_PATTERNS.join(', ')}）を ${GATEWAY_WORKER} に割り当て、
      ${APP_WORKER} のバージョン <version-id> を 100% で本番に出す。変更前の状態を <file> に記録する
      （戻すときは node scripts/cloudflare/rollback.mjs --cutover-state <file> ...）

環境変数: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID`;

/** gateway 以外が直接ルートを持つと gateway を経由しなくなる Worker */
const INTERNAL_WORKERS = [APP_WORKER, AUTH_WORKER, MCP_WORKER];

function findSingleRoute(routes, pattern) {
  const matches = routes.filter((route) => route.pattern === pattern);
  if (matches.length > 1) throw new Error(`パターン ${pattern} のルートが複数あります`);
  return matches[0] ?? null;
}

/**
 * カットオーバーの計画（純粋関数）
 * @param {{ id: string, pattern: string, script: string | null }[]} existingRoutes ゾーンの現在のルート
 * @param {string[]} patterns 割り当てるパターン
 * @param {string} targetScript 割り当て先の Worker
 * @returns {{
 *   operations: ({ type: 'update', routeId: string, pattern: string, script: string } | { type: 'create', pattern: string, script: string } | { type: 'noop', routeId: string, pattern: string, script: string })[],
 *   previous: { pattern: string, existed: boolean, routeId: string | null, script: string | null }[],
 *   warnings: string[],
 * }}
 */
export function planRouteCutover(existingRoutes, patterns, targetScript, { internalWorkers = INTERNAL_WORKERS } = {}) {
  if (new Set(patterns).size !== patterns.length) throw new Error('パターンが重複しています');
  const operations = [];
  const previous = [];
  for (const pattern of patterns) {
    const route = findSingleRoute(existingRoutes, pattern);
    if (route) {
      previous.push({ pattern, existed: true, routeId: route.id, script: route.script });
      operations.push(
        route.script === targetScript
          ? { type: 'noop', routeId: route.id, pattern, script: targetScript }
          : { type: 'update', routeId: route.id, pattern, script: targetScript }
      );
    } else {
      previous.push({ pattern, existed: false, routeId: null, script: null });
      operations.push({ type: 'create', pattern, script: targetScript });
    }
  }
  const warnings = existingRoutes
    .filter((route) => !patterns.includes(route.pattern) && internalWorkers.includes(route.script))
    .map(
      (route) =>
        `ルート ${route.pattern} が ${route.script} に直接割り当てられています（${targetScript} を経由しません）。不要なら削除してください`
    );
  return { operations, previous, warnings };
}

/**
 * ルートのロールバックの計画（純粋関数）
 * - カットオーバー前にあったルート: 割り当てを以前の Worker（無ければ Worker なし）に戻す。消えていたら作り直す
 * - カットオーバーで作ったルート: まだ targetScript を指していれば削除する（別の Worker に変わっていれば触れない）
 */
export function planRouteRollback(previous, currentRoutes, targetScript) {
  const operations = [];
  const warnings = [];
  for (const prev of previous) {
    const current = findSingleRoute(currentRoutes, prev.pattern);
    if (prev.existed) {
      if (!current) operations.push({ type: 'create', pattern: prev.pattern, script: prev.script });
      else if (current.script === prev.script) {
        operations.push({ type: 'noop', routeId: current.id, pattern: prev.pattern, script: prev.script });
      } else operations.push({ type: 'update', routeId: current.id, pattern: prev.pattern, script: prev.script });
    } else if (!current) {
      operations.push({ type: 'noop', routeId: null, pattern: prev.pattern, script: null });
    } else if (current.script === targetScript) {
      operations.push({ type: 'delete', routeId: current.id, pattern: prev.pattern });
    } else {
      warnings.push(`ルート ${prev.pattern} は ${current.script ?? '（Worker なし）'} に変わっているので触れません`);
      operations.push({ type: 'noop', routeId: current.id, pattern: prev.pattern, script: current.script });
    }
  }
  return { operations, warnings };
}

/** 新バージョンを 100% で出す wrangler の引数 */
export function appDeployArgs(versionId, workerName, message) {
  if (!UUID_PATTERN.test(versionId)) throw new Error(`バージョン ID が不正です: ${versionId}`);
  return ['versions', 'deploy', `${versionId}@100%`, '--name', workerName, '--yes', '--message', message];
}

/** カットオーバーの状態ファイルを読む */
export function readCutoverState(file) {
  const state = JSON.parse(readFileSync(file, 'utf8'));
  if (state?.schema !== STATE_SCHEMA) throw new Error(`状態ファイルの形式が違います（schema ${state?.schema}）: ${file}`);
  if (typeof state.zoneId !== 'string' || !Array.isArray(state.routes) || typeof state.app?.worker !== 'string') {
    throw new Error(`状態ファイルの内容が不正です: ${file}`);
  }
  return state;
}

export function describeRouteOperation(op) {
  switch (op.type) {
    case 'update':
      return `${op.pattern}: 割り当てを ${op.script ?? '（Worker なし）'} に変更`;
    case 'create':
      return `${op.pattern}: ルートを作成（${op.script ?? 'Worker なし'}）`;
    case 'delete':
      return `${op.pattern}: ルートを削除`;
    case 'noop':
      return `${op.pattern}: 変更なし（${op.script ?? 'ルート/Worker なし'}）`;
    default:
      throw new Error(`未知の操作: ${JSON.stringify(op)}`);
  }
}

/** ルートの操作を API で行う。作成したときは新しいルートの ID を返す */
export async function applyRouteOperation(client, zoneId, op) {
  switch (op.type) {
    case 'update':
      await client.updateRoute(zoneId, op.routeId, { pattern: op.pattern, script: op.script });
      return null;
    case 'create':
      return (await client.createRoute(zoneId, { pattern: op.pattern, script: op.script })).id;
    case 'delete':
      await client.deleteRoute(zoneId, op.routeId);
      return null;
    case 'noop':
      return null;
    default:
      throw new Error(`未知の操作: ${JSON.stringify(op)}`);
  }
}

export function describeDeployment(deployment) {
  if (!deployment) return '（なし）';
  return deployment.versions.map((v) => `${v.version_id}@${v.percentage}%`).join(', ');
}

async function cutover(args) {
  const stateFile = args.state;
  const newVersionId = args['app-version'];
  if (!newVersionId || (!stateFile && !args['dry-run'])) {
    throw new Error(`--state と --app-version が必要です\n\n${USAGE}`);
  }
  if (!UUID_PATTERN.test(newVersionId)) throw new Error(`--app-version がバージョン ID（UUID）ではありません: ${newVersionId}`);
  if (stateFile && existsSync(stateFile)) {
    throw new Error(`状態ファイル ${stateFile} が既にあります。前回のカットオーバーの記録を上書きしないよう中止します`);
  }

  const client = clientFromEnv();
  const zoneId = await client.getZoneId(ZONE_NAME);
  const routes = await client.listRoutes(zoneId);
  const { deployment: previousDeployment } = await client.getCurrentDeployment(APP_WORKER);
  const plan = planRouteCutover(routes, [...ROUTE_PATTERNS], GATEWAY_WORKER);

  for (const op of plan.operations) console.log(`- ${describeRouteOperation(op)}`);
  console.log(`- ${APP_WORKER}: ${describeDeployment(previousDeployment)} → ${newVersionId}@100%`);
  for (const warning of plan.warnings) logWarning(warning);
  if (args['dry-run']) {
    console.log('--dry-run のため変更しません');
    return 0;
  }

  const state = {
    schema: STATE_SCHEMA,
    createdAt: new Date().toISOString(),
    zoneName: ZONE_NAME,
    zoneId,
    targetScript: GATEWAY_WORKER,
    routes: plan.previous,
    app: { worker: APP_WORKER, previousDeployment, newVersionId, deployStarted: false },
  };
  writeJsonFileAtomic(stateFile, state);
  console.log(`変更前の状態を ${stateFile} に記録しました`);

  for (const [index, op] of plan.operations.entries()) {
    const createdRouteId = await applyRouteOperation(client, zoneId, op);
    if (createdRouteId) {
      state.routes[index].createdRouteId = createdRouteId;
      writeJsonFileAtomic(stateFile, state);
    }
    console.log(`ルート ${describeRouteOperation(op)}: 完了`);
  }

  state.app.deployStarted = true;
  writeJsonFileAtomic(stateFile, state);
  runWrangler(appDeployArgs(newVersionId, APP_WORKER, `cutover ${newVersionId.slice(0, 8)}`), {
    appDir: WORKER_DIRS[APP_WORKER],
  });
  console.log('カットオーバーが完了しました');
  return 0;
}

export async function main(argv) {
  const args = parseCliArgs(argv, {
    state: { type: 'string' },
    'app-version': { type: 'string' },
    'dry-run': { type: 'boolean' },
  });
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  return cutover(args);
}

if (isMainModule(import.meta.url)) await runCli(main);
