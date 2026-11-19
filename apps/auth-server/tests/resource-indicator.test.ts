import { describe, expect, it } from 'vitest';
import { prepareAuthorizationRequest } from '../src/resource-indicator';

const ISSUER = 'https://maronn-household-budget.com';
const MCP = `${ISSUER}/mcp`;
const options = { resources: { [MCP]: 'household' } };

const authorize = (params: Record<string, string | string[]>) => {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    for (const v of [value].flat()) search.append(name, v);
  }
  return new Request(`${ISSUER}/authorize?${search}`);
};

async function params(result: Request | Response) {
  expect(result).toBeInstanceOf(Request);
  const request = result as Request;
  return request.method === 'POST'
    ? new URLSearchParams(await request.text())
    : new URL(request.url).searchParams;
}

describe('prepareAuthorizationRequest', () => {
  it('MCP の resource を指定した認可リクエストは、そのリソースを audience にし、offline_access と prompt=consent を加える', async () => {
    const result = await prepareAuthorizationRequest(
      authorize({ client_id: 'dcr-x', scope: 'household', resource: MCP }),
      options
    );

    const p = await params(result);
    expect(p.getAll('audience')).toEqual([MCP]);
    expect(p.get('scope')).toBe('household offline_access');
    expect(p.get('prompt')).toBe('consent');
    expect(p.get('resource')).toBe(MCP);
  });

  it('resource がなくても MCP のスコープを求めていれば MCP を audience にする（古いクライアントの救済）', async () => {
    const p = await params(
      await prepareAuthorizationRequest(authorize({ client_id: 'dcr-x', scope: 'household offline_access' }), options)
    );

    expect(p.getAll('audience')).toEqual([MCP]);
    expect(p.get('scope')).toBe('household offline_access');
  });

  it('知らない resource は invalid_target で拒否する（他のサーバー宛てのトークンを出さない）', async () => {
    const result = await prepareAuthorizationRequest(
      authorize({ client_id: 'dcr-x', scope: 'household', resource: 'https://evil.example.com/mcp' }),
      options
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('invalid_target');
  });

  it('クライアントが直接指定した audience は取り除く', async () => {
    const p = await params(
      await prepareAuthorizationRequest(
        authorize({ client_id: 'household-app', scope: 'openid', audience: 'https://evil.example.com' }),
        options
      )
    );

    expect(p.has('audience')).toBe(false);
    expect(p.get('scope')).toBe('openid');
    expect(p.has('prompt')).toBe(false);
  });

  it('prompt=none（画面を出さない確認）のときは prompt=consent を加えない', async () => {
    const p = await params(
      await prepareAuthorizationRequest(authorize({ scope: 'household', resource: MCP, prompt: 'none' }), options)
    );

    expect(p.get('prompt')).toBe('none');
  });

  it('POST の認可リクエスト（フォーム）も同じように書き換える', async () => {
    const request = new Request(`${ISSUER}/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: 'dcr-x', scope: 'household', resource: MCP }),
    });

    const p = await params(await prepareAuthorizationRequest(request, options));

    expect(p.getAll('audience')).toEqual([MCP]);
    expect(p.get('client_id')).toBe('dcr-x');
  });

  it('Content-Type の大文字小文字やパラメータの違いでは素通りできない', async () => {
    const request = new Request(`${ISSUER}/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'Application/X-WWW-Form-Urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ client_id: 'dcr-x', scope: 'household', resource: 'https://evil.example.com' }),
    });

    const result = await prepareAuthorizationRequest(request, options);

    expect((result as Response).status).toBe(400);
  });

  it('フォーム以外の本文の POST は 400 にする', async () => {
    const request = new Request(`${ISSUER}/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'https://evil.example.com' }),
    });

    expect(((await prepareAuthorizationRequest(request, options)) as Response).status).toBe(400);
  });

  it.each(['constructor', 'toString', '__proto__'])('オブジェクトのプロパティ名（%s）を resource にしても許可リストに一致しない', async (resource) => {
    const result = await prepareAuthorizationRequest(authorize({ scope: 'household', resource }), options);

    expect((result as Response).status).toBe(400);
  });

  it('/authorize 以外のリクエストはそのまま通す', async () => {
    const request = new Request(`${ISSUER}/token`, { method: 'POST', body: 'audience=x' });

    expect(await prepareAuthorizationRequest(request, options)).toBe(request);
  });
});
