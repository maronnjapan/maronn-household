import { describe, expect, it } from 'vitest';
import {
  GOOGLE_PROBE_CODE,
  buildGoogleCredentialProbe,
  checkGoogleCredentials,
  describeRouteAssignments,
  evaluateGoogleCredentialCheck,
  findMissingSecrets,
  formatMissingSecretsMessage,
} from './preflight.mjs';

const complete = {
  CLOUDFLARE_API_TOKEN: 't',
  CLOUDFLARE_ACCOUNT_ID: 'a',
  CLOUDFLARE_D1_API_TOKEN: 'd',
  GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 's',
};

describe('findMissingSecrets', () => {
  it('すべてそろっていれば空', () => {
    expect(findMissingSecrets(complete)).toEqual([]);
  });

  it('未設定・空文字・空白だけの secret を挙げる（GitHub Actions は未設定の secret を空文字にする）', () => {
    const missing = findMissingSecrets({ ...complete, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: ' \n', CLOUDFLARE_D1_API_TOKEN: undefined });
    expect(missing.map((m) => m.secret)).toEqual(['CLOUDFLARE_D1_API_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
  });
});

describe('formatMissingSecretsMessage', () => {
  it('追加すべき GitHub secret と、本番が変わっていないことを伝える', () => {
    const message = formatMissingSecretsMessage(findMissingSecrets({ ...complete, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }));
    expect(message).toContain('GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET');
    expect(message).toContain('Secrets and variables → Actions');
    expect(message).toContain('旧バージョンのまま');
  });
});

describe('describeRouteAssignments', () => {
  it('パターンごとの現在の割り当てを示す', () => {
    const routes = [
      { id: 'r1', pattern: 'maronn-household-budget.com/*', script: 'household-app' },
      { id: 'r2', pattern: 'maronn-household-budget.com/mcp', script: 'mcp-server' },
    ];
    expect(describeRouteAssignments(routes)).toEqual([
      'maronn-household-budget.com/* → household-app',
      'www.maronn-household-budget.com/* → （ルートなし）',
    ]);
  });
});

const SECRET = 'GOCSPX-super-secret-value';
const googleError = (status, error, description) => ({
  status,
  body: JSON.stringify(description ? { error, error_description: description } : { error }),
});

describe('buildGoogleCredentialProbe', () => {
  it('ダミーの認可コードで、household-auth と同じリダイレクト URI と client_secret_post で問い合わせる', () => {
    const { url, init } = buildGoogleCredentialProbe({ clientId: 'id.apps.googleusercontent.com', clientSecret: SECRET });
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      grant_type: 'authorization_code',
      code: GOOGLE_PROBE_CODE,
      client_id: 'id.apps.googleusercontent.com',
      client_secret: SECRET,
      redirect_uri: 'https://maronn-household-budget.com/api/auth/callback/google',
    });
  });
});

describe('evaluateGoogleCredentialCheck', () => {
  it('invalid_grant（ダミーのコードだけが拒否された）なら資格情報は正しい', () => {
    expect(evaluateGoogleCredentialCheck(googleError(400, 'invalid_grant', 'Malformed auth code.'))).toEqual({ ok: true });
  });

  it('invalid_client / unauthorized_client は資格情報の誤りとして失敗（やり直さない）', () => {
    for (const error of ['invalid_client', 'unauthorized_client']) {
      const result = evaluateGoogleCredentialCheck(googleError(401, error, 'Unauthorized'), [SECRET]);
      expect(result.ok).toBe(false);
      expect(result.retryable).toBe(false);
      expect(result.reason).toContain(`error=${error}`);
      expect(result.reason).toContain('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET');
    }
  });

  it('リダイレクト URI が未登録なら失敗', () => {
    const result = evaluateGoogleCredentialCheck(googleError(400, 'redirect_uri_mismatch'));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('https://maronn-household-budget.com/api/auth/callback/google');
  });

  it('接続できない・JSON でない・想定外のエラーは、確かめられないので失敗にしてエラーコードを示す', () => {
    const network = evaluateGoogleCredentialCheck({ networkError: 'fetch failed' });
    expect(network).toMatchObject({ ok: false, retryable: true });
    expect(network.reason).toContain('fetch failed');

    const html = evaluateGoogleCredentialCheck({ status: 502, body: '<html>Bad Gateway</html>' });
    expect(html).toMatchObject({ ok: false, retryable: true });
    expect(html.reason).toContain('HTTP 502');

    const unexpected = evaluateGoogleCredentialCheck(googleError(400, 'invalid_request', 'Missing code'));
    expect(unexpected).toMatchObject({ ok: false, retryable: false });
    expect(unexpected.reason).toContain('error=invalid_request');

    expect(evaluateGoogleCredentialCheck({ status: 200, body: '{"access_token":"x"}' }).ok).toBe(false);
  });

  it('理由の文字列に secret を出さない', () => {
    const echoed = [
      googleError(401, 'invalid_client', `bad secret ${SECRET}`),
      googleError(400, `weird_${SECRET}`, SECRET),
      { networkError: `connect failed for ${SECRET}` },
    ];
    for (const response of echoed) {
      const result = evaluateGoogleCredentialCheck(response, [SECRET]);
      expect(result.ok).toBe(false);
      expect(result.reason).not.toContain(SECRET);
    }
  });
});

describe('checkGoogleCredentials', () => {
  /** 決まった応答を順に返す fetch（ネットワークには出ない） */
  function scriptedFetch(responses) {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return new Response(next.body, { status: next.status });
    };
    return { fetchImpl, calls };
  }

  it('正しい資格情報なら 1 回の問い合わせで通る', async () => {
    const { fetchImpl, calls } = scriptedFetch([googleError(400, 'invalid_grant')]);
    expect(await checkGoogleCredentials({ clientId: 'id', clientSecret: SECRET, fetchImpl })).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it('一時的な失敗（接続失敗・5xx）はやり直し、資格情報の誤りはやり直さない', async () => {
    const flaky = scriptedFetch([new TypeError('fetch failed'), { status: 503, body: 'busy' }, googleError(400, 'invalid_grant')]);
    const waits = [];
    const result = await checkGoogleCredentials({
      clientId: 'id',
      clientSecret: SECRET,
      fetchImpl: flaky.fetchImpl,
      wait: async (ms) => waits.push(ms),
    });
    expect(result).toEqual({ ok: true });
    expect(waits).toHaveLength(2);

    const wrong = scriptedFetch([googleError(401, 'invalid_client'), googleError(400, 'invalid_grant')]);
    const rejected = await checkGoogleCredentials({ clientId: 'id', clientSecret: SECRET, fetchImpl: wrong.fetchImpl, wait: async () => {} });
    expect(rejected.ok).toBe(false);
    expect(wrong.calls).toHaveLength(1);
  });

  it('やり直しても接続できなければ失敗にする', async () => {
    const down = scriptedFetch([new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed')]);
    const result = await checkGoogleCredentials({ clientId: 'id', clientSecret: SECRET, fetchImpl: down.fetchImpl, wait: async () => {} });
    expect(result.ok).toBe(false);
    expect(down.calls).toHaveLength(3);
  });
});
