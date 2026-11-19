#!/usr/bin/env node
/**
 * カットオーバー後のスモークテスト（本番の公開 URL に対して）
 *
 * ルートの変更が反映されるまで時間がかかることがあるので、全項目が通るまで間隔を広げながら数回やり直す。
 * リダイレクトは追わない（redirect: 'manual'）ので、各 URL が直接返した応答を検査する。
 */
import { PUBLIC_ORIGIN } from './config.mjs';
import { isMainModule, logError, parseCliArgs, runCli, sleep } from './cli-utils.mjs';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 64 * 1024;

const USAGE = `使い方: node scripts/cloudflare/smoke-test.mjs [--origin ${PUBLIC_ORIGIN}] [--attempts 8] [--initial-delay-ms 5000]

公開 URL に対して OpenID Provider・MCP・家計簿アプリの応答を確かめる。すべて通れば終了コード 0。`;

/** household-app クライアントの認可リクエスト（PKCE は RFC 7636 付録 B の例） */
const AUTHORIZE_QUERY = new URLSearchParams({
  response_type: 'code',
  client_id: 'household-app',
  redirect_uri: 'https://maronn-household-budget.com/api/session/callback',
  scope: 'openid',
  state: 'x',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256',
}).toString();

const MCP_INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'deploy-smoke-test', version: '1.0.0' },
  },
});

/** 確かめるリクエスト */
export const SMOKE_CHECKS = Object.freeze([
  { name: 'openid-configuration', method: 'GET', path: '/.well-known/openid-configuration', accept: 'application/json' },
  { name: 'oauth-authorization-server', method: 'GET', path: '/.well-known/oauth-authorization-server', accept: 'application/json' },
  { name: 'household-page', method: 'GET', path: '/household', accept: 'text/html' },
  {
    name: 'mcp-without-token',
    method: 'POST',
    path: '/mcp',
    accept: 'application/json, text/event-stream',
    contentType: 'application/json',
    body: MCP_INITIALIZE,
  },
  { name: 'protected-resource-metadata', method: 'GET', path: '/.well-known/oauth-protected-resource/mcp', accept: 'application/json' },
  { name: 'authorize-redirects-to-login', method: 'GET', path: `/authorize?${AUTHORIZE_QUERY}`, accept: 'text/html' },
]);

function parseJson(body) {
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false };
  }
}

function expectStatus(observation, status) {
  return observation.status === status ? null : `HTTP ${observation.status}（期待値 ${status}）`;
}

function expectJsonField(observation, field, expected) {
  const json = parseJson(observation.body ?? '');
  if (!json.ok) return '本文が JSON ではありません';
  if (json.value?.[field] !== expected) return `${field} が ${JSON.stringify(json.value?.[field])}（期待値 ${expected}）`;
  return null;
}

/** 各チェックの判定。理由（文字列）を返せば失敗、null なら成功 */
const EVALUATORS = {
  'openid-configuration': (o, origin) => expectStatus(o, 200) ?? expectJsonField(o, 'issuer', origin),
  // gateway が OIDC Discovery と同じ文書を返す（旧 household-app の別 issuer の文書なら失敗にする）
  'oauth-authorization-server': (o, origin) => expectStatus(o, 200) ?? expectJsonField(o, 'issuer', origin),
  'household-page': (o) => expectStatus(o, 200),
  'mcp-without-token': (o) => {
    const status = expectStatus(o, 401);
    if (status) return status;
    const header = o.headers['www-authenticate'];
    if (!header) return 'WWW-Authenticate ヘッダーがありません';
    return header.includes('resource_metadata=') ? null : `WWW-Authenticate に resource_metadata= がありません: ${header}`;
  },
  'protected-resource-metadata': (o, origin) => expectStatus(o, 200) ?? expectJsonField(o, 'resource', `${origin}/mcp`),
  'authorize-redirects-to-login': (o, origin) => {
    const status = expectStatus(o, 302);
    if (status) return status;
    const location = o.headers.location;
    if (!location) return 'Location ヘッダーがありません';
    let url;
    try {
      url = new URL(location, origin);
    } catch {
      return `Location が URL ではありません: ${location}`;
    }
    if (url.origin !== origin || url.pathname !== '/login') {
      return `Location が ${origin}/login ではありません: ${location}`;
    }
    return null;
  },
};

/**
 * 観測した応答を判定する（純粋関数）
 * @param {string} origin 例: https://maronn-household-budget.com
 * @param {{ name: string, status?: number, headers?: Record<string, string>, body?: string, error?: string }[]} observations
 * @returns {{ name: string, ok: boolean, reason: string | null }[]}
 */
export function evaluateSmokeResults(origin, observations) {
  const normalizedOrigin = new URL(origin).origin;
  return SMOKE_CHECKS.map(({ name }) => {
    const observation = observations.find((o) => o.name === name);
    if (!observation) return { name, ok: false, reason: '応答がありません' };
    if (observation.error) return { name, ok: false, reason: `リクエストに失敗しました: ${observation.error}` };
    const reason = EVALUATORS[name]({ ...observation, headers: observation.headers ?? {} }, normalizedOrigin);
    return { name, ok: reason === null, reason };
  });
}

/** 再試行の待ち時間（指数的に伸ばし、上限 30 秒） */
export function backoffDelays(attempts, initialDelayMs, maxDelayMs = 30_000) {
  return Array.from({ length: Math.max(0, attempts - 1) }, (_, i) => Math.min(initialDelayMs * 2 ** i, maxDelayMs));
}

async function observe(origin, check, fetchImpl) {
  const headers = { accept: check.accept, 'cache-control': 'no-cache', 'user-agent': 'deploy-smoke-test' };
  if (check.contentType) headers['content-type'] = check.contentType;
  try {
    const response = await fetchImpl(new URL(check.path, origin), {
      method: check.method,
      headers,
      body: check.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await response.text()).slice(0, MAX_BODY_CHARS);
    return { name: check.name, status: response.status, headers: Object.fromEntries(response.headers), body };
  } catch (error) {
    return { name: check.name, error: error instanceof Error ? error.message : String(error) };
  }
}

/** すべてのチェックを、通るまで最大 attempts 回やり直す */
export async function runSmokeTests({ origin, attempts, initialDelayMs, fetchImpl = globalThis.fetch, wait = sleep }) {
  const delays = backoffDelays(attempts, initialDelayMs);
  let results = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const observations = await Promise.all(SMOKE_CHECKS.map((check) => observe(origin, check, fetchImpl)));
    results = evaluateSmokeResults(origin, observations);
    const failed = results.filter((r) => !r.ok);
    console.log(`試行 ${attempt}/${attempts}: ${results.length - failed.length}/${results.length} 件成功`);
    if (failed.length === 0) return { ok: true, results };
    for (const r of failed) console.log(`  NG ${r.name}: ${r.reason}`);
    if (attempt < attempts) await wait(delays[attempt - 1]);
  }
  return { ok: false, results };
}

function parsePositiveInt(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${name} は 0 以上の整数にしてください: ${value}`);
  return number;
}

export async function main(argv) {
  const args = parseCliArgs(argv, {
    origin: { type: 'string' },
    attempts: { type: 'string' },
    'initial-delay-ms': { type: 'string' },
  });
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const origin = new URL(args.origin ?? PUBLIC_ORIGIN).origin;
  const attempts = Math.max(1, parsePositiveInt(args.attempts ?? '8', '--attempts'));
  const initialDelayMs = parsePositiveInt(args['initial-delay-ms'] ?? '5000', '--initial-delay-ms');

  console.log(`${origin} にスモークテストを実行します`);
  const { ok, results } = await runSmokeTests({ origin, attempts, initialDelayMs });
  if (!ok) {
    const failed = results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.reason}`);
    logError(`スモークテストに失敗しました\n${failed.join('\n')}`);
    return 1;
  }
  for (const r of results) console.log(`  OK ${r.name}`);
  console.log('スモークテストに成功しました');
  return 0;
}

if (isMainModule(import.meta.url)) await runCli(main);
