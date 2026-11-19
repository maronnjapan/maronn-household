import { describe, expect, it } from 'vitest';
import { SMOKE_CHECKS, backoffDelays, evaluateSmokeResults, runSmokeTests } from './smoke-test.mjs';

const ORIGIN = 'https://maronn-household-budget.com';

/** すべてのチェックが通る応答 */
function healthyObservations() {
  return [
    { name: 'openid-configuration', status: 200, headers: {}, body: JSON.stringify({ issuer: ORIGIN }) },
    { name: 'oauth-authorization-server', status: 200, headers: {}, body: JSON.stringify({ issuer: ORIGIN }) },
    { name: 'household-page', status: 200, headers: { 'content-type': 'text/html' }, body: '<html></html>' },
    {
      name: 'mcp-without-token',
      status: 401,
      headers: {
        'www-authenticate': `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="household"`,
      },
      body: '{"error":"invalid_token"}',
    },
    { name: 'protected-resource-metadata', status: 200, headers: {}, body: JSON.stringify({ resource: `${ORIGIN}/mcp` }) },
    {
      name: 'authorize-redirects-to-login',
      status: 302,
      headers: { location: `${ORIGIN}/login?transaction_id=abc` },
      body: '',
    },
  ];
}

function withChange(name, change) {
  return healthyObservations().map((o) => (o.name === name ? { ...o, ...change } : o));
}

const failures = (observations) =>
  evaluateSmokeResults(ORIGIN, observations)
    .filter((r) => !r.ok)
    .map((r) => r.name);

describe('evaluateSmokeResults', () => {
  it('期待どおりの応答ならすべて成功', () => {
    const results = evaluateSmokeResults(ORIGIN, healthyObservations());
    expect(results.map((r) => r.name)).toEqual(SMOKE_CHECKS.map((c) => c.name));
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('OIDC Discovery の issuer が公開オリジンでなければ失敗', () => {
    expect(failures(withChange('openid-configuration', { body: JSON.stringify({ issuer: 'https://auth.example.com' }) }))).toEqual([
      'openid-configuration',
    ]);
    expect(failures(withChange('openid-configuration', { body: '<html>' }))).toEqual(['openid-configuration']);
  });

  it('RFC 8414 のメタデータが 200 の JSON でなければ失敗（旧アプリの別 issuer の文書も失敗）', () => {
    expect(failures(withChange('oauth-authorization-server', { status: 404 }))).toEqual(['oauth-authorization-server']);
    expect(
      failures(withChange('oauth-authorization-server', { body: JSON.stringify({ issuer: `${ORIGIN}/oauth` }) }))
    ).toEqual(['oauth-authorization-server']);
  });

  it('/household が 200 でなければ失敗（リダイレクトも失敗）', () => {
    expect(failures(withChange('household-page', { status: 302 }))).toEqual(['household-page']);
    expect(failures(withChange('household-page', { status: 500 }))).toEqual(['household-page']);
  });

  it('トークンなしの /mcp は 401 と resource_metadata 付きの WWW-Authenticate でなければ失敗', () => {
    expect(failures(withChange('mcp-without-token', { status: 200 }))).toEqual(['mcp-without-token']);
    expect(failures(withChange('mcp-without-token', { headers: {} }))).toEqual(['mcp-without-token']);
    expect(failures(withChange('mcp-without-token', { headers: { 'www-authenticate': 'Bearer' } }))).toEqual([
      'mcp-without-token',
    ]);
  });

  it('保護リソースのメタデータの resource が公開オリジンの /mcp でなければ失敗', () => {
    expect(failures(withChange('protected-resource-metadata', { status: 404 }))).toEqual(['protected-resource-metadata']);
    expect(
      failures(withChange('protected-resource-metadata', { body: JSON.stringify({ resource: 'https://other/mcp' }) }))
    ).toEqual(['protected-resource-metadata']);
  });

  it('認可リクエストは同じオリジンの /login への 302 でなければ失敗（相対の Location は可）', () => {
    expect(failures(withChange('authorize-redirects-to-login', { headers: { location: '/login?transaction_id=1' } }))).toEqual([]);
    expect(failures(withChange('authorize-redirects-to-login', { status: 200 }))).toEqual(['authorize-redirects-to-login']);
    expect(failures(withChange('authorize-redirects-to-login', { headers: {} }))).toEqual(['authorize-redirects-to-login']);
    expect(
      failures(withChange('authorize-redirects-to-login', { headers: { location: `${ORIGIN}/consent?transaction_id=1` } }))
    ).toEqual(['authorize-redirects-to-login']);
    expect(
      failures(withChange('authorize-redirects-to-login', { headers: { location: 'https://evil.example/login' } }))
    ).toEqual(['authorize-redirects-to-login']);
    expect(
      failures(
        withChange('authorize-redirects-to-login', {
          headers: { location: `${ORIGIN}/api/session/callback?error=invalid_request&state=x` },
        })
      )
    ).toEqual(['authorize-redirects-to-login']);
  });

  it('リクエスト自体の失敗や応答の欠落も失敗', () => {
    const observations = healthyObservations().filter((o) => o.name !== 'household-page');
    observations[0] = { name: 'openid-configuration', error: 'fetch failed' };
    expect(failures(observations)).toEqual(['openid-configuration', 'household-page']);
  });
});

describe('backoffDelays', () => {
  it('間隔を倍々に広げ、30 秒で頭打ちにする', () => {
    expect(backoffDelays(8, 5000)).toEqual([5000, 10000, 20000, 30000, 30000, 30000, 30000]);
    expect(backoffDelays(1, 5000)).toEqual([]);
  });
});

describe('runSmokeTests', () => {
  /** 決まった応答を返す fetch（ネットワークには出ない） */
  function fakeFetch(observationsByAttempt) {
    let attempt = 0;
    const requests = [];
    const fetchImpl = async (url, init) => {
      requests.push({ url: String(url), init });
      const path = `${url.pathname}${url.search}`;
      const check = SMOKE_CHECKS.find((c) => c.path === path);
      const observation = observationsByAttempt[Math.min(attempt, observationsByAttempt.length - 1)].find(
        (o) => o.name === check.name
      );
      return new Response(observation.body, { status: observation.status, headers: observation.headers });
    };
    return { fetchImpl, requests, nextAttempt: () => attempt++ };
  }

  it('反映待ちで失敗しても、やり直して通れば成功にする', async () => {
    const stale = withChange('openid-configuration', { status: 404, body: 'not found' });
    const fake = fakeFetch([stale, healthyObservations()]);
    const waits = [];
    const result = await runSmokeTests({
      origin: ORIGIN,
      attempts: 3,
      initialDelayMs: 1000,
      fetchImpl: fake.fetchImpl,
      wait: async (ms) => {
        waits.push(ms);
        fake.nextAttempt();
      },
    });
    expect(result.ok).toBe(true);
    expect(waits).toEqual([1000]);
    expect(fake.requests.every(({ init }) => init.redirect === 'manual')).toBe(true);
  });

  it('最後まで通らなければ失敗にする', async () => {
    const fake = fakeFetch([withChange('household-page', { status: 500, body: 'error' })]);
    const result = await runSmokeTests({
      origin: ORIGIN,
      attempts: 2,
      initialDelayMs: 0,
      fetchImpl: fake.fetchImpl,
      wait: async () => fake.nextAttempt(),
    });
    expect(result.ok).toBe(false);
    expect(result.results.filter((r) => !r.ok).map((r) => r.name)).toEqual(['household-page']);
  });

  it('認可リクエストは仕様どおりのクエリで送る', async () => {
    const fake = fakeFetch([healthyObservations()]);
    await runSmokeTests({ origin: ORIGIN, attempts: 1, initialDelayMs: 0, fetchImpl: fake.fetchImpl });
    const authorize = fake.requests.find(({ url }) => url.includes('/authorize'));
    expect(authorize.url).toBe(
      `${ORIGIN}/authorize?response_type=code&client_id=household-app&redirect_uri=https%3A%2F%2Fmaronn-household-budget.com%2Fapi%2Fsession%2Fcallback&scope=openid&state=x&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256`
    );
    const mcp = fake.requests.find(({ url }) => url.endsWith('/mcp'));
    expect(mcp.init.method).toBe('POST');
    expect(mcp.init.headers.authorization).toBeUndefined();
  });
});
