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

function setup() {
  const auth = createService('auth');
  const mcp = createService('mcp');
  const app = createService('app');
  const env: Env = { AUTH: auth.fetcher, MCP: mcp.fetcher, APP: app.fetcher };
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
