/**
 * 家計簿アプリのログイン（認証基盤の RP）の通しのテスト
 *
 * データベースは本物のローカル D1、認証基盤（AUTH の service binding）は本物の household-auth を使う。
 * 外部サービスの Google だけは、トークンエンドポイントと JWKS を代役に差し替える。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';
import { createTestDatabase, type TestDatabase } from '@maronn/test-utils';
import { createAuthServer } from 'auth-server/src/app';
import { generateSigningKey } from 'auth-server/src/signing-keys';
import { handleSessionRequest, type SessionEnv } from '../server/session/handler';
import { findSessionUser, safeReturnTo } from '../server/session/store';

const ISSUER = 'https://maronn-household-budget.com';
const CLIENT_SECRET = 'household-secret';
const BETTER_AUTH_SECRET = 'better-auth-secret';

let googleKey: CryptoKey;
let googleJwk: JWK;
let opSigningKey: string;
let testDb: TestDatabase;
let env: SessionEnv;
let auth: ReturnType<typeof createAuthServer>;
let authEnv: Parameters<typeof createAuthServer>[0];

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  googleKey = pair.privateKey;
  googleJwk = { ...(await exportJWK(pair.publicKey)), kid: 'google-key', alg: 'RS256' };
  opSigningKey = await generateSigningKey('op-key');
});

beforeEach(async () => {
  testDb = await createTestDatabase();
  authEnv = {
    DB: testDb.db,
    ISSUER,
    OIDC_SIGNING_KEY: opSigningKey,
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    HOUSEHOLD_CLIENT_SECRET: CLIENT_SECRET,
  };
  const googleFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const nonce = new URLSearchParams(String(init?.body)).get('code');
    const idToken = await new SignJWT({ nonce, email: 'taro@example.com', email_verified: true, name: '山田太郎' })
      .setProtectedHeader({ alg: 'RS256', kid: 'google-key' })
      .setIssuer('https://accounts.google.com')
      .setAudience('google-client')
      .setSubject('google-sub-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(googleKey);
    return Response.json({ id_token: idToken });
  };
  auth = createAuthServer(authEnv, {
    google: { fetch: googleFetch, jwks: createLocalJWKSet({ keys: [googleJwk] }) },
  });
  env = {
    DB: testDb.db,
    OIDC_ISSUER: ISSUER,
    HOUSEHOLD_CLIENT_SECRET: CLIENT_SECRET,
    BETTER_AUTH_SECRET,
    AUTH: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => auth.fetch(new Request(input, init), authEnv),
    } as unknown as Fetcher,
  };
});

afterEach(async () => {
  await testDb.dispose();
});

/** ブラウザの代わり: Cookie を持ち、アプリ（/api/session/*）と認証基盤（それ以外）にリクエストする */
class Browser {
  cookies = new Map<string, string>();

  async request(url: string | URL, init: RequestInit = {}) {
    const target = new URL(url, ISSUER);
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0) {
      headers.set('Cookie', [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    const request = new Request(target, { ...init, headers });
    const response = target.pathname.startsWith('/api/session')
      ? await handleSessionRequest(request, env)
      : await auth.fetch(request, authEnv);
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const index = pair!.indexOf('=');
      const name = pair!.slice(0, index);
      const value = pair!.slice(index + 1);
      if (/Max-Age=0/.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }

  async follow(response: Response) {
    expect([302, 303]).toContain(response.status);
    return this.request(response.headers.get('Location')!);
  }
}

/** /api/session/login から Google でのログインを経て、アプリのコールバックの直前（認証基盤のリダイレクト）まで進める */
async function signInUntilCallback(browser: Browser, returnTo = '/calendar') {
  const toAuthorize = await browser.request(`/api/session/login?return_to=${encodeURIComponent(returnTo)}`);
  const toLogin = await browser.follow(toAuthorize);
  const loginPage = await (await browser.follow(toLogin)).text();
  const googlePath = /href="(\/login\/google\?[^"]+)"/.exec(loginPage)![1]!.replace(/&amp;/g, '&');
  const toGoogle = new URL((await browser.request(googlePath)).headers.get('Location')!);
  const state = toGoogle.searchParams.get('state')!;
  const toConsent = await browser.request(`/api/auth/callback/google?state=${state}&code=${state}`);
  const consentPage = await (await browser.follow(toConsent)).text();
  const field = (name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(consentPage)![1]!;
  const transactionId = field('transaction_id');
  const toApp = await browser.request(`/consent?transaction_id=${transactionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ISSUER },
    body: new URLSearchParams({ transaction_id: transactionId, csrf_token: field('csrf_token'), action: 'approve' }),
  });
  return new URL(toApp.headers.get('Location')!);
}

async function sessionUser(browser: Browser) {
  return ((await (await browser.request('/api/session/me')).json()) as { user: { id: string } | null }).user;
}

describe('ログイン', () => {
  it('認証基盤の認可エンドポイントへ PKCE と state・nonce 付きでリダイレクトする', async () => {
    const browser = new Browser();

    const response = await browser.request('/api/session/login');

    const location = new URL(response.headers.get('Location')!);
    expect(`${location.origin}${location.pathname}`).toBe(`${ISSUER}/authorize`);
    expect(Object.fromEntries(location.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'household-app',
      redirect_uri: `${ISSUER}/api/session/callback`,
      scope: 'openid profile email',
      code_challenge_method: 'S256',
    });
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(location.searchParams.get('nonce')).toBeTruthy();
    expect(response.headers.get('Set-Cookie')).toMatch(/^__Host-hh_login=.+; Path=\/; HttpOnly; SameSite=Lax; Secure; Max-Age=600$/);
  });

  it('Google でログインすると、セッションを作って元のページに戻り、ログイン中のユーザーを返す', async () => {
    const browser = new Browser();
    const callback = await signInUntilCallback(browser, '/calendar');

    const response = await browser.request(callback);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/calendar');
    expect(browser.cookies.has('__Host-hh_session')).toBe(true);
    expect(browser.cookies.has('__Host-hh_login')).toBe(false);
    const user = await sessionUser(browser);
    expect(user).toMatchObject({ name: '山田太郎', email: 'taro@example.com' });
    // セッションのトークンはハッシュで保存する
    const stored = await testDb.db.prepare('SELECT token FROM session').first<{ token: string }>();
    expect(stored?.token).not.toBe(browser.cookies.get('__Host-hh_session'));
  });

  it('ログインを始めたブラウザでないコールバック（state の Cookie が違う）はログインにしない', async () => {
    const browser = new Browser();
    const callback = await signInUntilCallback(browser);
    browser.cookies.set('__Host-hh_login', 'other-state');

    const response = await browser.request(callback);

    expect(response.headers.get('Location')).toBe('/auth/login?error=login_failed');
    expect(browser.cookies.has('__Host-hh_session')).toBe(false);
  });

  it('同じコールバックは二度使えない', async () => {
    const browser = new Browser();
    const callback = await signInUntilCallback(browser);
    const login = browser.cookies.get('__Host-hh_login')!;
    await browser.request(callback);
    browser.cookies.delete('__Host-hh_session');
    browser.cookies.set('__Host-hh_login', login);

    const replay = await browser.request(callback);

    expect(replay.headers.get('Location')).toBe('/auth/login?error=login_failed');
  });
});

describe('ログアウト', () => {
  it('セッションを消し、認証基盤のログアウト（id_token_hint 付き）へ進める', async () => {
    const browser = new Browser();
    await browser.request(await signInUntilCallback(browser));

    const response = await browser.request('/api/session/logout', { method: 'POST', headers: { Origin: ISSUER } });
    const { redirectTo } = (await response.json()) as { redirectTo: string };

    const logout = new URL(redirectTo);
    expect(`${logout.origin}${logout.pathname}`).toBe(`${ISSUER}/logout`);
    expect(logout.searchParams.get('id_token_hint')).toBeTruthy();
    expect(logout.searchParams.get('post_logout_redirect_uri')).toBe(`${ISSUER}/`);
    expect(await sessionUser(browser)).toBeNull();
    expect(await testDb.db.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(0);
  });

  it('他のサイトからのログアウトのリクエストは拒否する', async () => {
    const browser = new Browser();
    await browser.request(await signInUntilCallback(browser));

    const response = await browser.request('/api/session/logout', {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com' },
    });

    expect(response.status).toBe(403);
    expect(await sessionUser(browser)).not.toBeNull();
  });
});

describe('セッションの判定', () => {
  async function insertUser() {
    await testDb.db
      .prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', '既存', 'a@example.com', 1, 'x', 'x')")
      .run();
  }

  it('移行期間は Better Auth のセッション Cookie（署名付き）も受け付ける', async () => {
    await insertUser();
    const expires = new Date(Date.now() + 60_000).toISOString();
    await testDb.db
      .prepare("INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES ('s1', ?, 'legacy-token', 'x', 'x', 'u1')")
      .bind(expires)
      .run();
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(BETTER_AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('legacy-token')))));
    const cookie = `__Secure-better-auth.session_token=${encodeURIComponent(`legacy-token.${signature}`)}`;

    const found = await findSessionUser(testDb.db, cookie, BETTER_AUTH_SECRET, true);
    const forged = await findSessionUser(testDb.db, `__Secure-better-auth.session_token=${encodeURIComponent('legacy-token.AAAA')}`, BETTER_AUTH_SECRET, true);

    expect(found?.user.id).toBe('u1');
    expect(forged).toBeNull();
  });

  it('期限切れのセッションはログインしていない扱い', async () => {
    await insertUser();
    const browser = new Browser();
    await browser.request(await signInUntilCallback(browser));
    await testDb.db.prepare("UPDATE session SET expires_at = '2000-01-01T00:00:00.000Z'").run();

    expect(await sessionUser(browser)).toBeNull();
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['/calendar', '/calendar'],
    ['/household/budget?x=1', '/household/budget?x=1'],
    ['/', '/'],
    ['https://evil.example.com/', '/household'],
    ['//evil.example.com', '/household'],
    ['/\\evil.example.com', '/household'],
    ['/authorize?client_id=x', '/household'],
    ['/api/session/logout', '/household'],
    [undefined, '/household'],
  ])('%s → %s', (input, expected) => {
    expect(safeReturnTo(input ?? null)).toBe(expected);
  });
});
