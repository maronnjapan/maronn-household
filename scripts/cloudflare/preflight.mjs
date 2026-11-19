#!/usr/bin/env node
/**
 * デプロイ前の確認（本番には何も変更しない）
 *
 * - 必要な GitHub secret がすべて渡っているか（とくに新しく追加する GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）
 * - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を Google が受け付けるか（household-auth に入れる前に確かめる。
 *   誤った値を入れると新しいログインがすべて失敗し、スモークテストでは気づけない）
 * - API トークンでゾーンを読めて、Workers ルートを一覧できるか
 * - household-app の現在のデプロイを読めるか（失敗時のロールバックに使う）
 * どれかを満たさなければ失敗する。そのときデプロイは何も変更せず、本番は旧バージョンのまま動き続ける。
 */
import { clientFromEnv } from './cloudflare-api.mjs';
import { APP_WORKER, GOOGLE_REDIRECT_URI, GOOGLE_TOKEN_ENDPOINT, ROUTE_PATTERNS, ZONE_NAME } from './config.mjs';
import { isMainModule, logError, parseCliArgs, runCli, sleep } from './cli-utils.mjs';

/** 環境変数名 → 値を入れる GitHub secret と説明 */
export const REQUIRED_SECRETS = Object.freeze([
  { env: 'CLOUDFLARE_API_TOKEN', secret: 'CLOUDFLARE_API_TOKEN', hint: 'Workers のデプロイとゾーンのルート編集ができる API トークン' },
  { env: 'CLOUDFLARE_ACCOUNT_ID', secret: 'CLOUDFLARE_ACCOUNT_ID', hint: 'Cloudflare のアカウント ID' },
  { env: 'CLOUDFLARE_D1_API_TOKEN', secret: 'CLOUDFLARE_D1_API_TOKEN', hint: 'D1 マイグレーション用の API トークン' },
  { env: 'GOOGLE_CLIENT_ID', secret: 'GOOGLE_CLIENT_ID', hint: 'Google Cloud Console の OAuth クライアント ID（household-auth が使う）' },
  { env: 'GOOGLE_CLIENT_SECRET', secret: 'GOOGLE_CLIENT_SECRET', hint: 'Google Cloud Console の OAuth クライアントシークレット（household-auth が使う）' },
]);

const USAGE = `使い方: node scripts/cloudflare/preflight.mjs

デプロイ前に、GitHub secret（${REQUIRED_SECRETS.map((s) => s.secret).join(', ')}）が渡っていること、
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を Google が受け付けること（${GOOGLE_TOKEN_ENDPOINT} にダミーの認可コードで問い合わせる）、
Cloudflare API トークンでゾーン ${ZONE_NAME} とその Workers ルートを読めることを確かめる。何も変更しない。`;

const NOT_CHANGED = 'このデプロイは本番に何も変更していません（本番は旧バージョンのまま動き続けます）。';

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
    NOT_CHANGED,
  ].join('\n');
}

/** 確認に使う認可コード（Google が発行したものではないので、正しいクライアントなら invalid_grant になる） */
export const GOOGLE_PROBE_CODE = 'deploy-preflight-dummy-code';
const GOOGLE_TIMEOUT_MS = 15_000;

/**
 * Google のトークンエンドポイントへの確認リクエスト（純粋関数）。
 * household-auth と同じく client_secret を本文で送る（client_secret_post）
 */
export function buildGoogleCredentialProbe({ clientId, clientSecret }) {
  return {
    url: GOOGLE_TOKEN_ENDPOINT,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: GOOGLE_PROBE_CODE,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: GOOGLE_REDIRECT_URI,
      }).toString(),
    },
  };
}

/**
 * Google の応答から、クライアントの資格情報が正しいかを判定する（純粋関数）
 * - invalid_grant: クライアントの認証は通り、ダミーのコードだけが拒否された → 正しい
 * - invalid_client / unauthorized_client: クライアント ID かシークレットが誤り → 失敗
 * - それ以外（接続できない・JSON でない・想定外のエラー）: 確かめられないので失敗（429 と 5xx と接続失敗はやり直せる）
 * 理由の文字列には secret を含めない（`secrets` に渡した値は伏せる）
 * @param {{ status?: number, body?: string, networkError?: string }} response
 * @param {string[]} secrets
 * @returns {{ ok: true } | { ok: false, retryable: boolean, reason: string }}
 */
export function evaluateGoogleCredentialCheck(response, secrets = []) {
  const redact = (text) => secrets.filter(Boolean).reduce((t, secret) => t.replaceAll(secret, '***'), String(text));
  if (response.networkError !== undefined) {
    return {
      ok: false,
      retryable: true,
      reason: redact(`Google のトークンエンドポイント（${GOOGLE_TOKEN_ENDPOINT}）に接続できません: ${response.networkError}`),
    };
  }
  let json = null;
  try {
    json = JSON.parse(response.body ?? '');
  } catch {
    // JSON でない応答は下で「予期しない応答」にする
  }
  const error = typeof json?.error === 'string' ? json.error : null;
  const description =
    typeof json?.error_description === 'string' ? `（${redact(json.error_description).slice(0, 200)}）` : '';
  if (error === 'invalid_grant') return { ok: true };
  if (error === 'invalid_client' || error === 'unauthorized_client') {
    return {
      ok: false,
      retryable: false,
      reason:
        `Google が GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を拒否しました（error=${redact(error)}${description}）。` +
        'Google Cloud Console の OAuth クライアント（ウェブアプリケーション）の値を GitHub secret に設定し直してください。',
    };
  }
  if (error === 'redirect_uri_mismatch') {
    return {
      ok: false,
      retryable: false,
      reason: `Google の OAuth クライアントに ${GOOGLE_REDIRECT_URI} が承認済みのリダイレクト URI として登録されていません（error=redirect_uri_mismatch）`,
    };
  }
  const status = response.status ?? 0;
  return {
    ok: false,
    retryable: status === 429 || status >= 500,
    reason:
      `Google のトークンエンドポイントから予期しない応答がありました（HTTP ${status}、error=${error ? redact(error) : 'なし'}${description}）。` +
      '資格情報を確かめられないので中止します',
  };
}

/** GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を Google に問い合わせて確かめる（一時的な失敗は数回やり直す） */
export async function checkGoogleCredentials({ clientId, clientSecret, fetchImpl = globalThis.fetch, attempts = 3, wait = sleep }) {
  const { url, init } = buildGoogleCredentialProbe({ clientId, clientSecret });
  for (let attempt = 1; ; attempt++) {
    let observed;
    try {
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
      observed = { status: response.status, body: await response.text() };
    } catch (error) {
      observed = { networkError: error instanceof Error ? error.message : String(error) };
    }
    const result = evaluateGoogleCredentialCheck(observed, [clientSecret]);
    if (result.ok || !result.retryable || attempt >= attempts) return result;
    await wait(2_000 * attempt);
  }
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

  const google = await checkGoogleCredentials({
    clientId: process.env.GOOGLE_CLIENT_ID.trim(),
    clientSecret: process.env.GOOGLE_CLIENT_SECRET.trim(),
  });
  if (!google.ok) {
    logError(`${google.reason}\n${NOT_CHANGED}`);
    return 1;
  }
  console.log('Google が GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を受け付けることを確かめました');

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
