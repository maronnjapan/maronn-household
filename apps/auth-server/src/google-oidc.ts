/**
 * Google を上流の OpenID Provider とする認可コードフロー（Workers で動く実装）
 *
 * @maronn-openid-connect/google-login は google-auth-library（Node.js 専用）に依存するため使わない。
 * ID トークンは jose で Google の JWKS を使って検証する。
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/** isolate 内でキャッシュする Google の公開鍵 */
export const googleJwks: JWTVerifyGetKey = createRemoteJWKSet(new URL(GOOGLE_JWKS_URI));

export interface GoogleAccount {
  subject: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

export function buildGoogleAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: 'openid email profile',
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

/**
 * PKCE の code_verifier を、秘密と nonce の HMAC-SHA256 から導出する。
 * 認可リクエストとコールバックで同じ値を作れるので、code_verifier を保存しなくてよい。
 */
export async function deriveCodeVerifier(secret: string, nonce: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`google-pkce:${nonce}`));
  return base64url(new Uint8Array(mac));
}

export async function codeChallengeFor(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return base64url(new Uint8Array(digest));
}

export async function exchangeGoogleCode(params: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: typeof fetch;
}): Promise<string> {
  const response = await (params.fetch ?? fetch)(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      code_verifier: params.codeVerifier,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
    }),
  });
  const body = (await response.json()) as { id_token?: string; error?: string };
  if (!response.ok || typeof body.id_token !== 'string') {
    throw new Error(`Google token request failed: ${body.error ?? response.status}`);
  }
  return body.id_token;
}

export async function verifyGoogleIdToken(
  idToken: string,
  options: { clientId: string; nonce: string; jwks?: JWTVerifyGetKey }
): Promise<GoogleAccount> {
  const { payload } = await jwtVerify(idToken, options.jwks ?? googleJwks, {
    issuer: GOOGLE_ISSUERS,
    audience: options.clientId,
    algorithms: ['RS256'],
  });
  if (payload.nonce !== options.nonce) {
    throw new Error('Google ID token nonce mismatch');
  }
  if (!payload.sub) {
    throw new Error('Google ID token has no sub');
  }
  return {
    subject: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
  };
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
