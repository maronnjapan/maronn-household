#!/usr/bin/env node
/**
 * 失敗したデプロイのロールバック
 *
 * record-deployments.mjs の記録（--workers-state）と cutover-routes.mjs の記録（--cutover-state）を読み、
 * デプロイと逆の順に戻す:
 *   1. household-app: デプロイ前の記録（無ければカットオーバー前の記録）のデプロイへ
 *   2. ルート: カットオーバー前の割り当てへ（カットオーバーで作ったルートは削除する）
 *   3. household-gateway → household-mcp → household-auth: デプロイ前の記録のデプロイへ
 * 現在のデプロイが記録と同じ Worker（そのステップまで進まなかったもの）は何もしない。
 * 記録したときにまだ無かった Worker は戻す先がないのでそのまま残す（ルートを持たないので公開されない）。
 *
 * 1 バージョン 100% のデプロイへは `wrangler rollback <id> --name <worker> --yes --message ...` で戻す。
 * 戻す先のあとに secret を入れていても、CI では確認なしで強制し、そのバージョンの secret に戻る
 * （`versions deploy` は secret が変わった古いバージョンへの切り替えをエラー 10220 で拒否する）。
 * 複数バージョンの配分へは `wrangler versions deploy <id>@<n>% ... --name <worker> --yes --message ...`。
 * 1 つが失敗しても残りを戻し、最後に失敗にする。
 */
import { existsSync } from 'node:fs';
import { clientFromEnv } from './cloudflare-api.mjs';
import { APP_WORKER, AUTH_WORKER, GATEWAY_WORKER, MCP_WORKER, WORKER_DIRS } from './config.mjs';
import { isMainModule, logError, logWarning, parseCliArgs, runCli } from './cli-utils.mjs';
import {
  applyRouteOperation,
  describeDeployment,
  describeRouteOperation,
  planRouteRollback,
  readCutoverState,
} from './cutover-routes.mjs';
import { readWorkersState } from './record-deployments.mjs';
import { runWrangler } from './wrangler.mjs';

const ROLLBACK_MESSAGE = 'deploy rollback';

const USAGE = `使い方: node scripts/cloudflare/rollback.mjs [--workers-state <file>] [--cutover-state <file>] [--if-exists]

デプロイ前の記録（record-deployments.mjs の --state）とカットオーバー前の記録（cutover-routes.mjs の --state）に戻す。
  --workers-state  ${APP_WORKER}, ${GATEWAY_WORKER}, ${MCP_WORKER}, ${AUTH_WORKER} を記録したデプロイに戻す
  --cutover-state  ルートの割り当てを戻す（--workers-state が無ければ ${APP_WORKER} もカットオーバー前に戻す）
  --if-exists      指定したファイルが無ければ飛ばす（そこまで進まずに失敗した場合）
環境変数: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID`;

/** 2 つのデプロイのトラフィック配分が同じか（順序は問わない） */
export function sameTraffic(a, b) {
  if (!a || !b || a.versions.length !== b.versions.length) return false;
  const percentages = new Map(a.versions.map((v) => [v.version_id, v.percentage]));
  return b.versions.every((v) => percentages.get(v.version_id) === v.percentage);
}

/**
 * 1 つの Worker を記録したデプロイに戻す計画（純粋関数）
 * @returns {{ type: 'none', reason: string } | { type: 'rollback', versionId: string } | { type: 'versions-deploy', specs: string[] }}
 */
export function planDeploymentRollback(targetDeployment, currentDeployment) {
  if (!targetDeployment) {
    return { type: 'none', reason: '記録したときにデプロイが無かった（まだ無かった）ので戻す先がありません' };
  }
  if (sameTraffic(targetDeployment, currentDeployment)) {
    return { type: 'none', reason: '記録したデプロイのままです' };
  }
  const { versions } = targetDeployment;
  if (versions.length === 1 && versions[0].percentage === 100) {
    return { type: 'rollback', versionId: versions[0].version_id };
  }
  return { type: 'versions-deploy', specs: versions.map((v) => `${v.version_id}@${v.percentage}%`) };
}

/** ロールバックの計画を wrangler の引数にする */
export function rollbackArgs(plan, workerName, message) {
  if (plan.type === 'rollback') return ['rollback', plan.versionId, '--name', workerName, '--yes', '--message', message];
  if (plan.type === 'versions-deploy') {
    return ['versions', 'deploy', ...plan.specs, '--name', workerName, '--yes', '--message', message];
  }
  throw new Error(`wrangler を実行しない計画です: ${plan.type}`);
}

/**
 * 戻す順序（純粋関数）。デプロイと逆の順: household-app → ルート → household-gateway → household-mcp → household-auth
 * @param {{ workersState?: { workers: Record<string, { deployment: object | null }> } | null, cutoverState?: object | null }} states
 * @returns {({ type: 'worker', worker: string, target: object | null, source: 'workers-state' | 'cutover-state' } | { type: 'routes' })[]}
 */
export function planRollbackSteps({ workersState = null, cutoverState = null }) {
  const recorded = workersState?.workers ?? {};
  const steps = [];
  if (recorded[APP_WORKER]) {
    // デプロイ前の記録を優先する（household-auth と同じ時点の secret に戻すため）
    steps.push({ type: 'worker', worker: APP_WORKER, target: recorded[APP_WORKER].deployment, source: 'workers-state' });
  } else if (cutoverState?.app?.deployStarted) {
    steps.push({ type: 'worker', worker: APP_WORKER, target: cutoverState.app.previousDeployment, source: 'cutover-state' });
  }
  if (cutoverState) steps.push({ type: 'routes' });
  for (const worker of [GATEWAY_WORKER, MCP_WORKER, AUTH_WORKER]) {
    if (recorded[worker]) {
      steps.push({ type: 'worker', worker, target: recorded[worker].deployment, source: 'workers-state' });
    }
  }
  return steps;
}

async function rollbackWorker(client, { worker, target }) {
  const { deployment: current } = await client.getCurrentDeployment(worker);
  const plan = planDeploymentRollback(target, current);
  if (plan.type === 'none') {
    console.log(`${worker}: ${plan.reason}`);
    return;
  }
  console.log(`${worker}: ${describeDeployment(current)} → ${describeDeployment(target)}`);
  runWrangler(rollbackArgs(plan, worker, ROLLBACK_MESSAGE), { appDir: WORKER_DIRS[worker] });
}

async function rollbackRoutes(client, cutoverState, failures) {
  const currentRoutes = await client.listRoutes(cutoverState.zoneId);
  const { operations, warnings } = planRouteRollback(cutoverState.routes, currentRoutes, cutoverState.targetScript);
  for (const warning of warnings) logWarning(warning);
  for (const op of operations) {
    try {
      await applyRouteOperation(client, cutoverState.zoneId, op);
      console.log(`ルート ${describeRouteOperation(op)}: 完了`);
    } catch (error) {
      failures.push(`ルート ${op.pattern}`);
      logError(`ルート ${describeRouteOperation(op)} に失敗しました: ${error instanceof Error ? error.message : error}`);
    }
  }
}

function loadState(file, read, ifExists, label) {
  if (!file) return null;
  if (!existsSync(file)) {
    if (ifExists) {
      console.log(`${label} ${file} がありません（そこまで進まなかったので戻すものはありません）`);
      return null;
    }
    throw new Error(`${label} ${file} がありません`);
  }
  return read(file);
}

export async function main(argv) {
  const args = parseCliArgs(argv, {
    'workers-state': { type: 'string' },
    'cutover-state': { type: 'string' },
    'if-exists': { type: 'boolean' },
  });
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args['workers-state'] && !args['cutover-state']) {
    throw new Error(`--workers-state か --cutover-state が必要です\n\n${USAGE}`);
  }
  const ifExists = Boolean(args['if-exists']);
  const workersState = loadState(args['workers-state'], readWorkersState, ifExists, 'デプロイ前の記録');
  const cutoverState = loadState(args['cutover-state'], readCutoverState, ifExists, 'カットオーバー前の記録');
  const steps = planRollbackSteps({ workersState, cutoverState });
  if (steps.length === 0) {
    console.log('戻すものはありません');
    return 0;
  }

  const client = clientFromEnv();
  const failures = [];
  for (const step of steps) {
    const label = step.type === 'routes' ? 'ルート' : step.worker;
    try {
      if (step.type === 'routes') await rollbackRoutes(client, cutoverState, failures);
      else await rollbackWorker(client, step);
    } catch (error) {
      failures.push(label);
      logError(`${label} のロールバックに失敗しました: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `ロールバックで失敗したものがあります: ${failures.join(', ')}（scripts/cloudflare/README.md の手動ロールバックを参照）`
    );
  }
  console.log('ロールバックが完了しました');
  return 0;
}

if (isMainModule(import.meta.url)) await runCli(main);
