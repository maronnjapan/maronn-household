#!/usr/bin/env node
/**
 * カットオーバーとロールバック
 *
 * カットオーバー（--state <file> --app-version <id>）:
 *   1. 変更の前に、ルートの割り当てと household-app の現在のデプロイを状態ファイルに記録する
 *   2. ルート（maronn-household-budget.com/* と www.…/*）を household-gateway に割り当てる。
 *      同じパターンのルートがあれば PUT で割り当て先だけを変え（未割り当ての時間ができない）、無ければ POST で作る
 *   3. `wrangler versions deploy <id>@100% --name household-app --yes` で household-app の新バージョンを本番に出す
 *
 * ロールバック（--rollback <file>）: 状態ファイルを読み、逆順に戻す
 *   1. household-app を記録しておいたデプロイに戻す（1 バージョンなら `wrangler rollback <id>`、
 *      複数バージョンの配分なら `wrangler versions deploy <id>@<n>% ...`）
 *   2. 各ルートを以前の割り当てに戻す（カットオーバーで作ったルートは削除する）
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
import { isMainModule, logError, logWarning, parseCliArgs, runCli } from './cli-utils.mjs';
import { UUID_PATTERN, runWrangler } from './wrangler.mjs';

export const STATE_SCHEMA = 1;

const USAGE = `使い方:
  node scripts/cloudflare/cutover-routes.mjs --state <file> --app-version <version-id> [--dry-run]
      ルート（${ROUTE_PATTERNS.join(', ')}）を ${GATEWAY_WORKER} に割り当て、
      ${APP_WORKER} のバージョン <version-id> を 100% で本番に出す。変更前の状態を <file> に記録する

  node scripts/cloudflare/cutover-routes.mjs --rollback <file> [--if-exists]
      <file> に記録した状態に戻す（${APP_WORKER} のデプロイとルートの割り当て）。
      --if-exists: <file> が無ければ何もせず成功する（カットオーバーが何も変更する前に失敗した場合）

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

/** 2 つのデプロイのトラフィック配分が同じか */
export function sameTraffic(a, b) {
  if (!a || !b || a.versions.length !== b.versions.length) return false;
  const percentages = new Map(a.versions.map((v) => [v.version_id, v.percentage]));
  return b.versions.every((v) => percentages.get(v.version_id) === v.percentage);
}

/**
 * household-app のロールバックの計画（純粋関数）
 * @returns {{ type: 'none', reason: string } | { type: 'rollback', versionId: string } | { type: 'versions-deploy', specs: string[] }}
 */
export function planAppRollback(previousDeployment, currentDeployment) {
  if (!previousDeployment) {
    return { type: 'none', reason: 'カットオーバー前のデプロイが無い（初回のデプロイ）ので戻す先がありません' };
  }
  if (sameTraffic(previousDeployment, currentDeployment)) {
    return { type: 'none', reason: '既にカットオーバー前のデプロイです' };
  }
  const { versions } = previousDeployment;
  if (versions.length === 1 && versions[0].percentage === 100) {
    return { type: 'rollback', versionId: versions[0].version_id };
  }
  return { type: 'versions-deploy', specs: versions.map((v) => `${v.version_id}@${v.percentage}%`) };
}

/** 新バージョンを 100% で出す wrangler の引数 */
export function appDeployArgs(versionId, workerName, message) {
  if (!UUID_PATTERN.test(versionId)) throw new Error(`バージョン ID が不正です: ${versionId}`);
  return ['versions', 'deploy', `${versionId}@100%`, '--name', workerName, '--yes', '--message', message];
}

/**
 * ロールバックの wrangler の引数。
 * 1 バージョンなら `wrangler rollback`（secret が変わっていても CI では確認なしで強制する。
 * `versions deploy` は secret 変更後の古いバージョンへの切り替えをエラー 10220 で拒否するため）
 */
export function appRollbackArgs(plan, workerName, message) {
  if (plan.type === 'rollback') return ['rollback', plan.versionId, '--name', workerName, '--yes', '--message', message];
  if (plan.type === 'versions-deploy') {
    return ['versions', 'deploy', ...plan.specs, '--name', workerName, '--yes', '--message', message];
  }
  throw new Error(`wrangler を実行しない計画です: ${plan.type}`);
}

export function readState(file) {
  const state = JSON.parse(readFileSync(file, 'utf8'));
  if (state?.schema !== STATE_SCHEMA) throw new Error(`状態ファイルの形式が違います（schema ${state?.schema}）: ${file}`);
  if (typeof state.zoneId !== 'string' || !Array.isArray(state.routes) || typeof state.app?.worker !== 'string') {
    throw new Error(`状態ファイルの内容が不正です: ${file}`);
  }
  return state;
}

/** 途中で止まっても壊れたファイルが残らないよう、一時ファイルに書いてから置き換える */
function writeState(file, state) {
  writeFileSync(`${file}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

function describeRouteOperation(op) {
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

async function applyRouteOperation(client, zoneId, op) {
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

function describeDeployment(deployment) {
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
  writeState(stateFile, state);
  console.log(`変更前の状態を ${stateFile} に記録しました`);

  for (const [index, op] of plan.operations.entries()) {
    const createdRouteId = await applyRouteOperation(client, zoneId, op);
    if (createdRouteId) {
      state.routes[index].createdRouteId = createdRouteId;
      writeState(stateFile, state);
    }
    console.log(`ルート ${describeRouteOperation(op)}: 完了`);
  }

  state.app.deployStarted = true;
  writeState(stateFile, state);
  runWrangler(appDeployArgs(newVersionId, APP_WORKER, `cutover ${newVersionId.slice(0, 8)}`), {
    appDir: WORKER_DIRS[APP_WORKER],
  });
  console.log('カットオーバーが完了しました');
  return 0;
}

async function rollback(args) {
  const stateFile = args.rollback;
  if (!existsSync(stateFile)) {
    if (args['if-exists']) {
      console.log(`状態ファイル ${stateFile} がありません。カットオーバーは何も変更していないので戻すものはありません`);
      return 0;
    }
    throw new Error(`状態ファイル ${stateFile} がありません`);
  }
  const state = readState(stateFile);
  const client = clientFromEnv();
  const failures = [];

  // 1. household-app（カットオーバーと逆順に、先に戻す）
  if (!state.app.deployStarted) {
    console.log(`${state.app.worker}: 新バージョンを出す前に止まったので戻しません`);
  } else {
    try {
      const { deployment: currentDeployment } = await client.getCurrentDeployment(state.app.worker);
      const plan = planAppRollback(state.app.previousDeployment, currentDeployment);
      if (plan.type === 'none') {
        console.log(`${state.app.worker}: ${plan.reason}`);
      } else {
        console.log(`${state.app.worker}: ${describeDeployment(currentDeployment)} → ${describeDeployment(state.app.previousDeployment)}`);
        runWrangler(appRollbackArgs(plan, state.app.worker, 'deploy rollback'), { appDir: WORKER_DIRS[APP_WORKER] });
      }
    } catch (error) {
      failures.push(`${state.app.worker} のロールバック`);
      logError(`${state.app.worker} のロールバックに失敗しました: ${error instanceof Error ? error.message : error}`);
    }
  }

  // 2. ルート
  try {
    const currentRoutes = await client.listRoutes(state.zoneId);
    const { operations, warnings } = planRouteRollback(state.routes, currentRoutes, state.targetScript);
    for (const warning of warnings) logWarning(warning);
    for (const op of operations) {
      try {
        await applyRouteOperation(client, state.zoneId, op);
        console.log(`ルート ${describeRouteOperation(op)}: 完了`);
      } catch (error) {
        failures.push(`ルート ${op.pattern}`);
        logError(`ルート ${describeRouteOperation(op)} に失敗しました: ${error instanceof Error ? error.message : error}`);
      }
    }
  } catch (error) {
    failures.push('ルートの一覧');
    logError(`ルートを読めません: ${error instanceof Error ? error.message : error}`);
  }

  if (failures.length > 0) {
    throw new Error(`ロールバックで失敗したものがあります: ${failures.join(', ')}（scripts/cloudflare/README.md の手動ロールバックを参照）`);
  }
  console.log('ロールバックが完了しました');
  return 0;
}

export async function main(argv) {
  const args = parseCliArgs(argv, {
    state: { type: 'string' },
    'app-version': { type: 'string' },
    rollback: { type: 'string' },
    'if-exists': { type: 'boolean' },
    'dry-run': { type: 'boolean' },
  });
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.rollback !== undefined) {
    if (args.state || args['app-version'] || args['dry-run']) {
      throw new Error('--rollback は --state / --app-version / --dry-run と一緒に使えません');
    }
    return rollback(args);
  }
  if (args['if-exists']) throw new Error('--if-exists は --rollback と一緒にだけ使えます');
  return cutover(args);
}

if (isMainModule(import.meta.url)) await runCli(main);
