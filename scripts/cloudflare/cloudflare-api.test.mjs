import { describe, expect, it } from 'vitest';
import {
  CloudflareApiError,
  createCloudflareClient,
  isScriptNotFoundError,
  nextPageQuery,
  normalizeDeployment,
  parseApiResponse,
} from './cloudflare-api.mjs';

const ACCOUNT = 'acc123';

/** 決まった応答を順に返す fetch（ネットワークには出ない）。受けたリクエストを記録する */
function scriptedFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
    const next = responses.shift();
    if (!next) throw new Error('想定外のリクエスト');
    if (next instanceof Error) throw next;
    return { status: next.status, text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)) };
  };
  return { fetchImpl, calls };
}

const client = (responses) => {
  const scripted = scriptedFetch(responses);
  return {
    ...scripted,
    api: createCloudflareClient({ apiToken: 'token-xyz', accountId: ACCOUNT, fetchImpl: scripted.fetchImpl, retryDelaysMs: [0, 0] }),
  };
};

const ok = (result, extra = {}) => ({ status: 200, body: { success: true, errors: [], messages: [], result, ...extra } });
const fail = (status, code, message) => ({ status, body: { success: false, errors: [{ code, message }], result: null } });

describe('parseApiResponse', () => {
  it('success: true の result と result_info を返す', () => {
    const parsed = parseApiResponse({
      method: 'GET',
      path: '/x',
      status: 200,
      text: JSON.stringify({ success: true, result: [1], result_info: { page: 1 } }),
    });
    expect(parsed).toEqual({ result: [1], resultInfo: { page: 1 } });
  });

  it('success: false はエラーコードとメッセージ付きの例外にする', () => {
    const call = () =>
      parseApiResponse({
        method: 'PUT',
        path: '/zones/z/workers/routes/r',
        status: 400,
        text: JSON.stringify({ success: false, errors: [{ code: 10020, message: 'bad pattern' }] }),
      });
    expect(call).toThrow(CloudflareApiError);
    expect(call).toThrow('[10020] bad pattern');
  });

  it('HTTP 200 でも success が true でなければ失敗にする', () => {
    expect(() => parseApiResponse({ method: 'GET', path: '/x', status: 200, text: '{"result":[]}' })).toThrow(
      CloudflareApiError
    );
  });

  it('2xx の空の本文は成功として扱う', () => {
    expect(parseApiResponse({ method: 'DELETE', path: '/x', status: 200, text: '' })).toEqual({
      result: null,
      resultInfo: null,
    });
  });

  it('JSON でない本文は、成功した DELETE のときだけ受け入れる', () => {
    expect(parseApiResponse({ method: 'DELETE', path: '/x', status: 200, text: 'OK' }).result).toBeNull();
    expect(() => parseApiResponse({ method: 'GET', path: '/x', status: 200, text: '<html>' })).toThrow('JSON でない');
    expect(() => parseApiResponse({ method: 'DELETE', path: '/x', status: 502, text: '<html>' })).toThrow('HTTP 502');
  });
});

describe('isScriptNotFoundError', () => {
  const error = (status, code) => new CloudflareApiError({ method: 'GET', path: '/x', status, errors: [{ code, message: 'm' }] });

  it('HTTP 404 かつコード 10007 のときだけ「Worker が無い」とみなす', () => {
    expect(isScriptNotFoundError(error(404, 10007))).toBe(true);
    expect(isScriptNotFoundError(error(400, 10007))).toBe(false);
    expect(isScriptNotFoundError(error(404, 10000))).toBe(false);
    expect(isScriptNotFoundError(error(403, 10000))).toBe(false);
    expect(isScriptNotFoundError(new Error('network'))).toBe(false);
  });
});

describe('nextPageQuery', () => {
  it('カーソルがあれば次のカーソル、同じカーソルの繰り返しなら終わる', () => {
    expect(nextPageQuery({ cursor: 'abc' }, 1, undefined)).toEqual({ cursor: 'abc' });
    expect(nextPageQuery({ cursor: 'abc' }, 2, 'abc')).toBeNull();
  });

  it('ページ番号式なら total_pages まで進む', () => {
    expect(nextPageQuery({ page: 1, total_pages: 3 }, 1)).toEqual({ page: '2' });
    expect(nextPageQuery({ page: 3, total_pages: 3 }, 3)).toBeNull();
    expect(nextPageQuery(null, 1)).toBeNull();
  });
});

describe('normalizeDeployment', () => {
  it('バージョン配分を取り出す', () => {
    expect(
      normalizeDeployment({ id: 'd1', strategy: 'percentage', versions: [{ version_id: 'v1', percentage: 100 }] })
    ).toEqual({ id: 'd1', versions: [{ version_id: 'v1', percentage: 100 }] });
  });

  it('バージョンが無い・形が違うデプロイは例外にする', () => {
    expect(() => normalizeDeployment({ versions: [] })).toThrow();
    expect(() => normalizeDeployment({ versions: [{ percentage: 100 }] })).toThrow();
  });
});

describe('createCloudflareClient', () => {
  it('トークンかアカウント ID が無ければ作れない', () => {
    expect(() => createCloudflareClient({ apiToken: '', accountId: ACCOUNT })).toThrow('CLOUDFLARE_API_TOKEN');
    expect(() => createCloudflareClient({ apiToken: 't', accountId: '' })).toThrow('CLOUDFLARE_ACCOUNT_ID');
  });

  it('Bearer トークンでリクエストし、ルートの割り当て先を PUT で変える', async () => {
    const { api, calls } = client([ok({ id: 'r1', pattern: 'a.com/*', script: 'household-gateway' })]);
    await api.updateRoute('zone1', 'r1', { pattern: 'a.com/*', script: 'household-gateway' });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe('https://api.cloudflare.com/client/v4/zones/zone1/workers/routes/r1');
    expect(calls[0].headers.Authorization).toBe('Bearer token-xyz');
    expect(JSON.parse(calls[0].body)).toEqual({ pattern: 'a.com/*', script: 'household-gateway' });
  });

  it('script が null のルートは script を送らない（Worker なしのルート）', async () => {
    const { api, calls } = client([ok({ id: 'r1' })]);
    await api.updateRoute('zone1', 'r1', { pattern: 'a.com/*', script: null });
    expect(JSON.parse(calls[0].body)).toEqual({ pattern: 'a.com/*' });
  });

  it('ゾーン名からゾーン ID を引く（アカウントが一致するものを選ぶ）', async () => {
    const { api, calls } = client([
      ok([
        { id: 'other', name: 'maronn-household-budget.com', account: { id: 'someone-else' } },
        { id: 'mine', name: 'maronn-household-budget.com', account: { id: ACCOUNT } },
      ]),
    ]);
    expect(await api.getZoneId('maronn-household-budget.com')).toBe('mine');
    expect(calls[0].url).toBe('https://api.cloudflare.com/client/v4/zones?name=maronn-household-budget.com');
  });

  it('ゾーンが見つからなければ権限の確認を促すエラーにする', async () => {
    const { api } = client([ok([])]);
    await expect(api.getZoneId('maronn-household-budget.com')).rejects.toThrow('Zone:Read');
  });

  it('ルート一覧はページをたどり、script が無いルートは null にする', async () => {
    const { api, calls } = client([
      ok([{ id: 'r1', pattern: 'a.com/*', script: 'household-app' }], { result_info: { page: 1, total_pages: 2 } }),
      ok([{ id: 'r2', pattern: 'a.com/static/*' }], { result_info: { page: 2, total_pages: 2 } }),
    ]);
    expect(await api.listRoutes('zone1')).toEqual([
      { id: 'r1', pattern: 'a.com/*', script: 'household-app' },
      { id: 'r2', pattern: 'a.com/static/*', script: null },
    ]);
    expect(calls[1].url).toContain('page=2');
  });

  it('Worker の削除: 404 かつ 10007 なら既に無いとみなす', async () => {
    const { api, calls } = client([fail(404, 10007, 'workers.api.error.script_not_found')]);
    expect(await api.deleteScript('mcp-server')).toBe('not-found');
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/mcp-server`);
  });

  it('Worker の削除: 権限エラーは「無い」と取り違えずに例外にする', async () => {
    const { api } = client([fail(403, 10000, 'Authentication error')]);
    await expect(api.deleteScript('mcp-server')).rejects.toThrow('[10000] Authentication error');
  });

  it('secret の一覧: Worker が無ければ null、それ以外の失敗は例外', async () => {
    const missing = client([fail(404, 10007, 'workers.api.error.script_not_found')]);
    expect(await missing.api.listScriptSecretNames('household-app')).toBeNull();

    const present = client([ok([{ name: 'A', type: 'secret_text' }, { name: 'B', type: 'secret_text' }])]);
    expect(await present.api.listScriptSecretNames('household-app')).toEqual(['A', 'B']);

    const broken = client([fail(500, 10013, 'internal'), fail(500, 10013, 'internal'), fail(500, 10013, 'internal')]);
    await expect(broken.api.listScriptSecretNames('household-auth')).rejects.toThrow('HTTP 500');
  });

  it('GET は一時的な失敗をやり直す', async () => {
    const { api, calls } = client([new Error('ECONNRESET'), fail(503, 0, 'busy'), ok({ deployments: [] })]);
    expect(await api.getCurrentDeployment('household-app')).toEqual({ scriptExists: true, deployment: null });
    expect(calls).toHaveLength(3);
  });

  it('変更系のリクエストはやり直さない', async () => {
    const { api, calls } = client([fail(503, 0, 'busy'), ok({ id: 'r9' })]);
    await expect(api.createRoute('zone1', { pattern: 'a.com/*', script: 'household-gateway' })).rejects.toThrow(
      'HTTP 503'
    );
    expect(calls).toHaveLength(1);
  });

  it('現在のデプロイ: 先頭（最新）のデプロイを返し、Worker が無ければ scriptExists: false', async () => {
    const present = client([
      ok({
        deployments: [
          { id: 'new', versions: [{ version_id: 'v2', percentage: 100 }] },
          { id: 'old', versions: [{ version_id: 'v1', percentage: 100 }] },
        ],
      }),
    ]);
    expect(await present.api.getCurrentDeployment('household-app')).toEqual({
      scriptExists: true,
      deployment: { id: 'new', versions: [{ version_id: 'v2', percentage: 100 }] },
    });

    const missing = client([fail(404, 10007, 'workers.api.error.script_not_found')]);
    expect(await missing.api.getCurrentDeployment('household-app')).toEqual({ scriptExists: false, deployment: null });
  });
});
