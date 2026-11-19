/**
 * 認証基盤の通しのフロー（生成OP + Google ログイン + D1）
 *
 * データベースは本物のローカル D1。外部サービスの Google だけは、トークンエンドポイントと JWKS を
 * ローカルの鍵で署名する代役に差し替える。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT, createLocalJWKSet, createRemoteJWKSet, customFetch, exportJWK, generateKeyPair, jwtVerify, type JWK } from 'jose';
import { createTestDatabase, type TestDatabase } from '@maronn/test-utils';
import { buildApp, type AuthEnv } from '../src/app';
import { generateSigningKeysSecret } from '../src/signing-keys';
import { codeChallengeFor } from '../src/google-oidc';

const ISSUER = 'https://maronn-household-budget.com';
const GOOGLE_CLIENT_ID = 'google-client.apps.googleusercontent.com';
const HOUSEHOLD_SECRET = 'household-secret';
const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

let googleKey: CryptoKey;
let googleJwk: JWK;
let signingKeys: string;
let testDb: TestDatabase;
let env: AuthEnv;
let app: ReturnType<typeof buildApp>;
let googleSub: string;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  googleKey = pair.privateKey;
  googleJwk = { ...(await exportJWK(pair.publicKey)), kid: 'google-key', alg: 'RS256' };
  signingKeys = await generateSigningKeysSecret('op-key');
});

beforeEach(async () => {
  testDb = await createTestDatabase();
  googleSub = 'google-sub-1';
  env = {
    DB: testDb.db,
    ISSUER,
    OIDC_SIGNING_KEYS: signingKeys,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'google-secret',
    HOUSEHOLD_CLIENT_SECRET: HOUSEHOLD_SECRET,
  };
  // Google のトークンエンドポイントの代役: 受け取った code に埋めた nonce で ID トークンを返す
  const googleFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const params = new URLSearchParams(String(init?.body));
    const idToken = await new SignJWT({
      nonce: params.get('code'),
      email: 'taro@example.com',
      email_verified: true,
      name: '山田太郎',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'google-key' })
      .setIssuer('https://accounts.google.com')
      .setAudience(GOOGLE_CLIENT_ID)
      .setSubject(googleSub)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(googleKey);
    return Response.json({ id_token: idToken });
  };
  app = buildApp(env, { google: { fetch: googleFetch, jwks: createLocalJWKSet({ keys: [googleJwk] }) } });
});

afterEach(async () => {
  await testDb.dispose();
});

/** ブラウザの代わりに Cookie を持って OP にリクエストする */
class Browser {
  cookies = new Map<string, string>();

  async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0) {
      headers.set('Cookie', [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    const response = await app.fetch(new Request(new URL(path, ISSUER), { ...init, headers }), env);
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const [name, value] = pair!.split('=');
      this.cookies.set(name!, value ?? '');
    }
    return response;
  }

  async postForm(path: string, fields: Record<string, string>) {
    return this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ISSUER },
      body: new URLSearchParams(fields),
    });
  }
}

function location(response: Response): URL {
  expect(response.status).toBe(302);
  return new URL(response.headers.get('Location')!, ISSUER);
}

function hiddenField(html: string, name: string): string {
  const match = new RegExp(`name="${name}" value="([^"]+)"`).exec(html);
  expect(match, `hidden field ${name}`).not.toBeNull();
  return match![1]!;
}

/** /authorize から Google ログインを経て同意画面まで進め、同意画面の HTML を返す */
async function loginWithGoogle(browser: Browser, authorizeParams: Record<string, string>) {
  const toLogin = location(await browser.request(`/authorize?${new URLSearchParams(authorizeParams)}`));
  expect(toLogin.pathname).toBe('/login');

  const loginPage = await (await browser.request(`${toLogin.pathname}${toLogin.search}`)).text();
  expect(loginPage).toContain('Googleでログイン');
  const googleLoginPath = /href="(\/login\/google\?[^"]+)"/.exec(loginPage)![1]!.replace(/&amp;/g, '&');

  const toGoogle = location(await browser.request(googleLoginPath));
  expect(toGoogle.origin).toBe('https://accounts.google.com');
  const state = toGoogle.searchParams.get('state')!;
  expect(toGoogle.searchParams.get('redirect_uri')).toBe(`${ISSUER}/api/auth/callback/google`);

  // 代役の Google は code に nonce を入れて返す
  const toConsent = location(
    await browser.request(`/api/auth/callback/google?${new URLSearchParams({ state, code: state })}`)
  );
  expect(toConsent.pathname).toBe('/consent');
  return { consentPage: await (await browser.request(`${toConsent.pathname}${toConsent.search}`)).text(), state };
}

async function approveConsent(browser: Browser, consentPage: string) {
  const transactionId = hiddenField(consentPage, 'transaction_id');
  return location(
    await browser.postForm(`/consent?transaction_id=${transactionId}`, {
      transaction_id: transactionId,
      csrf_token: hiddenField(consentPage, 'csrf_token'),
      action: 'approve',
    })
  );
}

async function verifyWithOpJwks(token: string) {
  const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`), {
    [customFetch]: (url: string) => app.fetch(new Request(url), env),
  });
  return (await jwtVerify(token, jwks, { issuer: ISSUER })).payload;
}

describe('ディスカバリ', () => {
  it('OIDC Discovery に、登録・ログアウトのエンドポイントと household スコープを載せる', async () => {
    const metadata = (await (await app.fetch(new Request(`${ISSUER}/.well-known/openid-configuration`), env)).json()) as Record<string, unknown>;

    expect(metadata).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      registration_endpoint: `${ISSUER}/register`,
      end_session_endpoint: `${ISSUER}/logout`,
      code_challenge_methods_supported: ['S256'],
    });
    expect(metadata.scopes_supported).toContain('household');
  });
});

describe('家計簿アプリ（ファーストパーティ）のログイン', () => {
  const authorizeParams = async () => ({
    response_type: 'code',
    client_id: 'household-app',
    redirect_uri: `${ISSUER}/api/session/callback`,
    scope: 'openid profile email',
    state: 'app-state',
    nonce: 'app-nonce',
    code_challenge: await codeChallengeFor(CODE_VERIFIER),
    code_challenge_method: 'S256',
  });

  it('既存ユーザーが Google でログインすると、同意画面は自動で承認され、既存の user_id の ID トークンを受け取る', async () => {
    const now = new Date().toISOString();
    await testDb.db.batch([
      testDb.db
        .prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('legacy-user', '太郎', 'taro@example.com', 1, ?, ?)")
        .bind(now, now),
      testDb.db
        .prepare("INSERT INTO account (id, account_id, provider_id, user_id, created_at, updated_at) VALUES ('a1', 'google-sub-1', 'google', 'legacy-user', ?, ?)")
        .bind(now, now),
    ]);
    const browser = new Browser();

    const { consentPage } = await loginWithGoogle(browser, await authorizeParams());
    expect(consentPage).toContain('document.forms[0].submit()');
    expect(consentPage).not.toContain('許可する');
    const callback = await approveConsent(browser, consentPage);

    expect(`${callback.origin}${callback.pathname}`).toBe(`${ISSUER}/api/session/callback`);
    expect(callback.searchParams.get('state')).toBe('app-state');
    const tokenResponse = await app.fetch(
      new Request(`${ISSUER}/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${btoa(`household-app:${HOUSEHOLD_SECRET}`)}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: callback.searchParams.get('code')!,
          redirect_uri: `${ISSUER}/api/session/callback`,
          code_verifier: CODE_VERIFIER,
        }),
      }),
      env
    );
    const tokens = (await tokenResponse.json()) as { id_token: string; access_token: string };
    const idToken = await verifyWithOpJwks(tokens.id_token);
    expect(idToken).toMatchObject({ sub: 'legacy-user', aud: 'household-app', nonce: 'app-nonce' });
    // アクセストークンを発行したときのプロフィールとメールは UserInfo から返す（OIDC Core 1.0 §5.4）
    const userinfo = await app.fetch(
      new Request(`${ISSUER}/userinfo`, { headers: { Authorization: `Bearer ${tokens.access_token}` } }),
      env
    );
    expect(await userinfo.json()).toMatchObject({ sub: 'legacy-user', email: 'taro@example.com', name: '山田太郎' });
  });

  it('Google のコールバックを別のブラウザ（トランザクションの Cookie がない）で開くと拒否する', async () => {
    const browser = new Browser();
    const toLogin = location(await browser.request(`/authorize?${new URLSearchParams(await authorizeParams())}`));
    const loginPage = await (await browser.request(`${toLogin.pathname}${toLogin.search}`)).text();
    const googleLoginPath = /href="(\/login\/google\?[^"]+)"/.exec(loginPage)![1]!.replace(/&amp;/g, '&');
    const state = location(await browser.request(googleLoginPath)).searchParams.get('state')!;

    const attackerBrowser = new Browser();
    const response = await attackerBrowser.request(`/api/auth/callback/google?state=${state}&code=${state}`);

    expect(response.status).toBe(400);
  });

  it('同じコールバックを二度使うことはできない', async () => {
    const browser = new Browser();
    const { state } = await loginWithGoogle(browser, await authorizeParams());

    const replay = await browser.request(`/api/auth/callback/google?state=${state}&code=${state}`);

    expect(replay.status).toBe(400);
  });
});

describe('MCP クライアント（動的クライアント登録）の認可', () => {
  it('動的登録した public クライアントが、同意画面で許可を得て household スコープのアクセストークンを受け取る', async () => {
    const registration = await app.fetch(
      new Request(`${ISSUER}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Claude',
          redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        }),
      }),
      env
    );
    expect(registration.status).toBe(201);
    const { client_id: clientId } = (await registration.json()) as { client_id: string };
    const browser = new Browser();

    const { consentPage } = await loginWithGoogle(browser, {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      scope: 'household',
      state: 'mcp-state',
      code_challenge: await codeChallengeFor(CODE_VERIFIER),
      code_challenge_method: 'S256',
      resource: `${ISSUER}/mcp`,
    });
    expect(consentPage).toContain('Claude');
    expect(consentPage).toContain('家計簿データ（支出・予算・レシート）の参照と記録');
    expect(consentPage).toContain('許可する');
    const callback = await approveConsent(browser, consentPage);

    const tokenResponse = await app.fetch(
      new Request(`${ISSUER}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code: callback.searchParams.get('code')!,
          redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
          code_verifier: CODE_VERIFIER,
        }),
      }),
      env
    );
    const tokens = (await tokenResponse.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    const accessToken = await verifyWithOpJwks(tokens.access_token);
    const user = await testDb.db.prepare('SELECT id FROM user').first<{ id: string }>();
    expect(accessToken).toMatchObject({ sub: user!.id, scope: 'household', client_id: clientId });
    expect(tokens.expires_in).toBe(900);
    expect(tokens.refresh_token).toBeTruthy();
  });
});
