#!/usr/bin/env node
/**
 * デプロイ前の確認（本番には何も変更しない）
 *
 * - 必要な GitHub secret がすべて渡っているか（とくに新しく追加する GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）
 * - API トークンでゾーンを読めて、Workers ルートを一覧できるか
 * - household-app の現在のデプロイを読めるか（失敗時のロールバックに使う）
 * どれかを満たさなければ失敗する。そのときデプロイは何も変更せず、本番は旧バージョンのまま動き続ける。
 */
import { clientFromEnv } from './cloudflare-api.mjs';
import { APP_WORKER, ROUTE_PATTERNS, ZONE_NAME } from './config.mjs';
import { isMainModule, logError, parseCliArgs, runCli } from './cli-utils.mjs';

/** 環境変数名 → 値を入れる GitHub secret と説明 */
export const REQUIRED_SECRETS = Object.freeze([
  { env: 'CLOUDFLARE_API_TOKEN', secret: 'CLOUDFLARE_API_TOKEN', hint: 'Workers のデプロイとゾーンのルート編集ができる API トークン' },
  { env: 'CLOUDFLARE_ACCOUNT_ID', secret: 'CLOUDFLARE_ACCOUNT_ID', hint: 'Cloudflare のアカウント ID' },
  { env: 'CLOUDFLARE_D1_API_TOKEN', secret: 'CLOUDFLARE_D1_API_TOKEN', hint: 'D1 マイグレーション用の API トークン' },
  { env: 'GOOGLE_CLIENT_ID', secret: 'GOOGLE_CLIENT_ID', hint: 'Google Cloud Console の OAuth クライアント ID（household-auth が使う）' },
  { env: 'GOOGLE_CLIENT_SECRET', secret: 'GOOGLE_CLIENT_SECRET', hint: 'Google Cloud Console の OAuth クライアントシークレット（household-auth が使う）' },
]);

const USAGE = `使い方: node scripts/cloudflare/preflight.mjs

デプロイ前に、GitHub secret（${REQUIRED_SECRETS.map((s) => s.secret).join(', ')}）が渡っていることと、
Cloudflare API トークンでゾーン ${ZONE_NAME} とその Workers ルートを読めることを確かめる。何も変更しない。`;

/** 未設定（空・空白のみ）の secret（純粋関数） */
export function findMissingSecrets(env, required = REQUIRED_SECRETS) {
  return required.filter(({ env: name }) => typeof env[name] !== 'string' || env[name].trim() === '');
}

export function formatMissingSecretsMessage(missing) {
  const lines = missing.map(({ secret, hint }) => `  - ${secret}: ${hint}`);
  return [
    `GitHub secret が設定されていません: ${missing.map((s) => s.secret).join(', ')}`,
    'リポジトリの Settings → Secrets and variables → Actions → New repository secret で次を追加してから、このワークフローを再実行してください。',
    ...lines,
    'このデプロイは本番に何も変更していません（本番は旧バージョンのまま動き続けます）。',
  ].join('\n');
}

/** ルートのパターンごとの現在の割り当て（ログ用、純粋関数） */
export function describeRouteAssignments(routes, patterns = ROUTE_PATTERNS) {
  return patterns.map((pattern) => {
    const route = routes.find((r) => r.pattern === pattern);
    if (!route) return `${pattern} → （ルートなし）`;
    return `${pattern} → ${route.script ?? '（Worker なし）'}`;
  });
}

export async function main(argv) {
  const args = parseCliArgs(argv, {});
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const missing = findMissingSecrets(process.env);
  if (missing.length > 0) {
    logError(formatMissingSecretsMessage(missing));
    return 1;
  }

  const client = clientFromEnv();
  let zoneId;
  let routes;
  try {
    zoneId = await client.getZoneId(ZONE_NAME);
    routes = await client.listRoutes(zoneId);
  } catch (error) {
    logError(
      `CLOUDFLARE_API_TOKEN でゾーン ${ZONE_NAME} の Workers ルートを読めません。` +
        `トークンに Zone:Read と Workers Routes:Edit（ゾーン ${ZONE_NAME}）があるか確認してください。\n` +
        `${error instanceof Error ? error.message : error}`
    );
    return 1;
  }
  console.log(`ゾーン ${ZONE_NAME} (${zoneId}) の現在のルート:`);
  for (const line of describeRouteAssignments(routes)) console.log(`  ${line}`);

  try {
    const { scriptExists, deployment } = await client.getCurrentDeployment(APP_WORKER);
    if (!scriptExists) console.log(`${APP_WORKER} はまだありません（初回のデプロイ）`);
    else if (!deployment) console.log(`${APP_WORKER} にはデプロイがありません`);
    else {
      const traffic = deployment.versions.map((v) => `${v.version_id} (${v.percentage}%)`).join(', ');
      console.log(`${APP_WORKER} の現在のデプロイ: ${traffic}`);
    }
  } catch (error) {
    logError(
      `${APP_WORKER} の現在のデプロイを読めません（ロールバックに必要）。` +
        `トークンに Workers Scripts:Edit があるか確認してください。\n${error instanceof Error ? error.message : error}`
    );
    return 1;
  }

  console.log('プリフライト OK');
  return 0;
}

if (isMainModule(import.meta.url)) await runCli(main);
