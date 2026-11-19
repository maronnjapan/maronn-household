/**
 * /api/session/* : 認証基盤（household-auth）を使ったログイン・ログアウト（OpenID Connect の認可コードフロー + PKCE）
 *
 * - GET  /api/session/login?return_to=…  認証基盤の /authorize へ
 * - GET  /api/session/callback           認可コードをトークンに交換し、ID トークンを検証してセッションを作る
 * - POST /api/session/logout             セッションを消し、認証基盤のログアウト（end_session）の URL を返す
 * - GET  /api/session/me                 ログイン中のユーザー（いなければ null）
 *
 * 認証基盤とは service binding（AUTH）で話す。同じゾーンの URL への fetch は Worker を経由しないため。
 */
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import {
  LOGIN_TRANSACTION_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  clearedSessionCookies,
  cookieNames,
  createSession,
  deleteSession,
  findSessionUser,
  parseCookies,
  randomToken,
  safeReturnTo,
  saveLoginTransaction,
  serializeCookie,
  sha256,
  takeLoginTransaction,
} from './store';

export interface SessionEnv {
  DB: D1Database;
  AUTH: Fetcher;
  /** 認証基盤の issuer（= 公開オリジン） */
  OIDC_ISSUER: string;
  HOUSEHOLD_CLIENT_SECRET: string;
  /** 移行期間だけ、Better Auth のセッション Cookie の検証に使う */
  BETTER_AUTH_SECRET?: string;
}

export const CLIENT_ID = 'household-app';
const SCOPE = 'openid profile email';
const LOGIN_FAILED = '/auth/login?error=login_failed';

let jwks: { issuer: string; get: ReturnType<typeof createRemoteJWKSet> } | undefined;

export async function handleSessionRequest(request: Request, env: SessionEnv): Promise<Response> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname.replace(/\/$/, '')}`;
  switch (route) {
    case 'GET /api/session/login':
      return startLogin(env, url.searchParams.get('return_to'));
    case 'GET /api/session/callback':
      return completeLogin(request, env, url);
    case 'POST /api/session/logout':
      return logout(request, env);
    case 'GET /api/session/me':
      return currentUser(request, env);
    default:
      return new Response('Not Found', { status: 404 });
  }
}

/** セッションの Cookie に Secure を付けるか（本番の https のみ。ローカル開発の http では付けない） */
function isSecure(env: SessionEnv): boolean {
  return env.OIDC_ISSUER.startsWith('https://');
}

function callbackUrl(env: SessionEnv): string {
  return `${env.OIDC_ISSUER}/api/session/callback`;
}

async function startLogin(env: SessionEnv, returnTo: string | null): Promise<Response> {
  const transaction = {
    state: randomToken(),
    nonce: randomToken(),
    codeVerifier: randomToken(),
    returnTo: safeReturnTo(returnTo),
  };
  await saveLoginTransaction(env.DB, transaction);
  const authorize = new URL('/authorize', env.OIDC_ISSUER);
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: callbackUrl(env),
    scope: SCOPE,
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge: await sha256(transaction.codeVerifier),
    code_challenge_method: 'S256',
  }).toString();
  const secure = isSecure(env);
  return redirect(authorize.toString(), [
    serializeCookie(cookieNames(secure).login, transaction.state, LOGIN_TRANSACTION_TTL_SECONDS, secure),
  ]);
}

async function completeLogin(request: Request, env: SessionEnv, url: URL): Promise<Response> {
  const secure = isSecure(env);
  const names = cookieNames(secure);
  const clearLogin = serializeCookie(names.login, '', 0, secure);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const issuer = url.searchParams.get('iss');
  // ログインを始めたブラウザか（state の Cookie）、認証基盤からの応答か（RFC 9207 の iss）を確かめる
  const browserState = parseCookies(request.headers.get('Cookie')).get(names.login);
  if (!state || state !== browserState || (issuer !== null && issuer !== env.OIDC_ISSUER)) {
    return redirect(LOGIN_FAILED, [clearLogin]);
  }
  const transaction = await takeLoginTransaction(env.DB, state);
  if (!transaction || !code) return redirect(LOGIN_FAILED, [clearLogin]);

  const idToken = await exchangeCode(env, code, transaction.codeVerifier);
  const subject = idToken && (await verifyIdToken(env, idToken, transaction.nonce));
  if (!idToken || !subject) return redirect(LOGIN_FAILED, [clearLogin]);

  const token = await createSession(env.DB, {
    userId: subject,
    idToken,
    userAgent: request.headers.get('User-Agent'),
  });
  return redirect(transaction.returnTo, [clearLogin, serializeCookie(names.session, token, SESSION_TTL_SECONDS, secure)]);
}

/** 認可コードを ID トークンに交換する（失敗したら null） */
async function exchangeCode(env: SessionEnv, code: string, codeVerifier: string): Promise<string | null> {
  const response = await env.AUTH.fetch(`${env.OIDC_ISSUER}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(env.HOUSEHOLD_CLIENT_SECRET)}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl(env),
      code_verifier: codeVerifier,
    }),
  });
  if (!response.ok) {
    console.error('[session] token request failed', response.status, await response.text());
    return null;
  }
  const body = (await response.json()) as { id_token?: unknown };
  return typeof body.id_token === 'string' ? body.id_token : null;
}

/** ID トークンを検証し、サブジェクト（= user.id）を返す（失敗したら null） */
async function verifyIdToken(env: SessionEnv, idToken: string, nonce: string): Promise<string | null> {
  if (jwks?.issuer !== env.OIDC_ISSUER) {
    jwks = {
      issuer: env.OIDC_ISSUER,
      get: createRemoteJWKSet(new URL(`${env.OIDC_ISSUER}/.well-known/jwks.json`), {
        [customFetch]: (input, init) => env.AUTH.fetch(input, init),
      }),
    };
  }
  const verified = await jwtVerify(idToken, jwks.get, {
    issuer: env.OIDC_ISSUER,
    audience: CLIENT_ID,
    algorithms: ['RS256'],
  }).catch((error: unknown) => {
    console.error('[session] ID token verification failed', error);
    return null;
  });
  // アクセストークン（typ=at+jwt）を ID トークンとして受け取らない
  if (!verified || verified.protectedHeader.typ === 'at+jwt' || verified.payload.nonce !== nonce) return null;
  return verified.payload.sub ?? null;
}

async function logout(request: Request, env: SessionEnv): Promise<Response> {
  // 他のサイトからログアウトさせられないよう、同じオリジンからのリクエストだけを受け付ける
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  if ((origin !== null && origin !== new URL(env.OIDC_ISSUER).origin) || (site !== null && site !== 'same-origin')) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  const secure = isSecure(env);
  const current = await findSessionUser(env.DB, request.headers.get('Cookie'), env.BETTER_AUTH_SECRET, secure);
  if (current) await deleteSession(env.DB, current.session.id);

  // 認証基盤のセッションも終える（RP-Initiated Logout）。ID トークンのない旧セッションはアプリのログアウトだけ
  const endSession = new URL('/logout', env.OIDC_ISSUER);
  endSession.search = new URLSearchParams({
    client_id: CLIENT_ID,
    post_logout_redirect_uri: `${env.OIDC_ISSUER}/`,
    ...(current?.session.idToken ? { id_token_hint: current.session.idToken } : {}),
  }).toString();
  const redirectTo = current?.session.idToken ? endSession.toString() : '/';
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  for (const cookie of clearedSessionCookies(secure)) headers.append('Set-Cookie', cookie);
  return Response.json({ redirectTo }, { headers });
}

async function currentUser(request: Request, env: SessionEnv): Promise<Response> {
  const current = await findSessionUser(env.DB, request.headers.get('Cookie'), env.BETTER_AUTH_SECRET, isSecure(env));
  return Response.json({ user: current?.user ?? null }, { headers: { 'Cache-Control': 'no-store' } });
}

function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}
