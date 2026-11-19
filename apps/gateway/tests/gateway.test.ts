import { describe, it, expect } from 'vitest';
import gateway, { type Env } from '../src/index';

/** 受け取ったリクエストを記録し、自分の名前を返すだけの転送先 Worker */
function createService(name: string) {
  const received: Request[] = [];
  return {
    received,
    fetcher: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        received.push(request);
        return new Response(name, { headers: { 'x-service': name } });
      },
    } as unknown as Fetcher,
  };
}

/** Workers Rate Limiting の代わり: キーごとに limit 回まで通す */
function createLimiter(limit: number) {
  const counts = new Map<string, number>();
  return {
    limit: async ({ key }: { key: string }) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { success: count <= limit };
    },
  } as unknown as RateLimit;
}

function setup(limit = 100, registerLimit = limit) {
  const auth = createService('auth');
  const mcp = createService('mcp');
  const app = createService('app');
  const env: Env = {
    AUTH: auth.fetcher,
    MCP: mcp.fetcher,
    APP: app.fetcher,
    AUTH_RATE_LIMITER: createLimiter(limit),
    REGISTER_RATE_LIMITER: createLimiter(registerLimit),
  };
  return { auth, mcp, app, env };
}

describe('gateway', () => {
  it('振り分け表に従って転送し、転送先のレスポンスをそのまま返す', async () => {
    const { env, auth, app } = setup();

    const tokenResponse = await gateway.fetch(
      new Request('https://maronn-household-budget.com/token', { method: 'POST', body: 'grant_type=x' }),
      env
    );
    const pageResponse = await gateway.fetch(
      new Request('https://maronn-household-budget.com/household'),
      env
    );

    expect(await tokenResponse.text()).toBe('auth');
    expect(await pageResponse.text()).toBe('app');
    expect(auth.received[0]?.method).toBe('POST');
    expect(await auth.received[0]?.text()).toBe('grant_type=x');
    expect(app.received[0]?.url).toBe('https://maronn-household-budget.com/household');
  });

  it('パスの書き換えがあるときはクエリを保ったまま書き換えたパスで転送する', async () => {
    const { env, auth } = setup();

    await gateway.fetch(
      new Request('https://maronn-household-budget.com/.well-known/oauth-authorization-server?x=1'),
      env
    );

    expect(auth.received[0]?.url).toBe(
      'https://maronn-household-budget.com/.well-known/openid-configuration?x=1'
    );
  });

  it('ヘッダーやCookieを保ったまま転送する', async () => {
    const { env, mcp } = setup();

    await gateway.fetch(
      new Request('https://maronn-household-budget.com/mcp', {
        method: 'POST',
        headers: { authorization: 'Bearer abc', cookie: 'a=b' },
      }),
      env
    );

    expect(mcp.received[0]?.headers.get('authorization')).toBe('Bearer abc');
    expect(mcp.received[0]?.headers.get('cookie')).toBe('a=b');
  });

  it('www へのアクセスは apex にリダイレクトし、どこにも転送しない', async () => {
    const { env, app } = setup();

    const response = await gateway.fetch(
      new Request('https://www.maronn-household-budget.com/calendar'),
      env
    );

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://maronn-household-budget.com/calendar');
    expect(app.received).toHaveLength(0);
  });
});

describe('レート制限', () => {
  it('動的クライアント登録は IP ごとに上限を超えると 429 で、認証基盤に届けない', async () => {
    const { env, auth } = setup(100, 2);
    const register = (ip: string) =>
      gateway.fetch(
        new Request('https://maronn-household-budget.com/register', {
          method: 'POST',
          headers: { 'CF-Connecting-IP': ip },
          body: '{}',
        }),
        env
      );

    const statuses = [(await register('203.0.113.1')).status, (await register('203.0.113.1')).status, (await register('203.0.113.1')).status];
    const otherIp = await register('203.0.113.2');

    expect(statuses).toEqual([200, 200, 429]);
    expect(otherIp.status).toBe(200);
    expect(auth.received).toHaveLength(3);
  });

  it('対象外のパスは制限しない', async () => {
    const { env } = setup(0);

    const response = await gateway.fetch(new Request('https://maronn-household-budget.com/household'), env);

    expect(response.status).toBe(200);
  });
});
