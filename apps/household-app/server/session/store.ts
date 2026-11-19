/**
 * 家計簿アプリのログイン状態（認証基盤 household-auth の RP としてのセッション）の D1 への読み書き
 *
 * - ログインのトランザクション（state / nonce / code_verifier / 戻り先）: verification テーブル（10分）
 * - セッション: session テーブル（Better Auth 時代と同じテーブル）。トークンは SHA-256 で保存する
 * - 移行期間は、Better Auth が発行した署名付きのセッション Cookie も受け付ける（平文トークンの行を引く）
 */

export const LOGIN_TRANSACTION_TTL_SECONDS = 10 * 60;
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** ログイン後に戻ってよいアプリのページ（認証基盤や API のパスへは戻さない） */
const RETURN_TO_PREFIXES = ['/household', '/calendar', '/settings', '/guide', '/contact', '/privacy', '/terms'];
const DEFAULT_RETURN_TO = '/household';

const SESSION_COOKIE = { secure: '__Host-hh_session', insecure: 'hh_session' };
const LOGIN_COOKIE = { secure: '__Host-hh_login', insecure: 'hh_login' };
/** Better Auth のセッション Cookie（移行期間だけ読む） */
const LEGACY_SESSION_COOKIES = ['__Secure-better-auth.session_token', 'better-auth.session_token'];

export interface LoginTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
}

export interface SessionUser {
  session: { id: string; expiresAt: string; idToken: string | null };
  user: { id: string; name: string; email: string; image: string | null };
}

export function cookieNames(secure: boolean) {
  return {
    session: secure ? SESSION_COOKIE.secure : SESSION_COOKIE.insecure,
    login: secure ? LOGIN_COOKIE.secure : LOGIN_COOKIE.insecure,
  };
}

export function serializeCookie(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${maxAge}`;
}

/** ログアウト時に消す Cookie（Better Auth の Cookie も消す） */
export function clearedSessionCookies(secure: boolean): string[] {
  return [cookieNames(secure).session, ...LEGACY_SESSION_COOKIES].map((name) =>
    serializeCookie(name, '', 0, name.startsWith('__') || secure)
  );
}

export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return cookies;
}

/** 戻り先を、アプリのページの相対パスに限る（オープンリダイレクトと、認証基盤の画面への誘導を防ぐ） */
export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return DEFAULT_RETURN_TO;
  if (/[\u0000-\u001f]/.test(value)) return DEFAULT_RETURN_TO;
  const path = value.split(/[?#]/)[0] ?? '';
  const allowed = path === '/' || RETURN_TO_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  return allowed ? value : DEFAULT_RETURN_TO;
}

export function randomToken(byteLength = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

export async function saveLoginTransaction(db: D1Database, transaction: LoginTransaction): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOGIN_TRANSACTION_TTL_SECONDS * 1000);
  const { state, ...value } = transaction;
  await db
    .prepare('INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), loginIdentifier(state), JSON.stringify(value), expiresAt.toISOString(), now.toISOString(), now.toISOString())
    .run();
}

/** ログインのトランザクションを取り出す（一度だけ。期限切れなら null） */
export async function takeLoginTransaction(db: D1Database, state: string): Promise<LoginTransaction | null> {
  const row = await db
    .prepare('DELETE FROM verification WHERE identifier = ? RETURNING value, expires_at')
    .bind(loginIdentifier(state))
    .first<{ value: string; expires_at: string }>();
  if (!row || row.expires_at <= new Date().toISOString()) return null;
  return { state, ...(JSON.parse(row.value) as Omit<LoginTransaction, 'state'>) };
}

function loginIdentifier(state: string): string {
  return `household-login:${state}`;
}

/** セッションを作り、Cookie に入れるトークンを返す */
export async function createSession(
  db: D1Database,
  params: { userId: string; idToken: string; userAgent: string | null }
): Promise<string> {
  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  await db
    .prepare(
      'INSERT INTO session (id, expires_at, token, created_at, updated_at, user_agent, user_id, id_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(crypto.randomUUID(), expiresAt.toISOString(), await sha256(token), now.toISOString(), now.toISOString(), params.userAgent, params.userId, params.idToken)
    .run();
  return token;
}

export async function findSessionUser(
  db: D1Database,
  cookieHeader: string | null,
  legacySecret: string | undefined,
  secure: boolean
): Promise<SessionUser | null> {
  const storedToken = await sessionTokenFromCookies(parseCookies(cookieHeader), legacySecret, secure);
  if (!storedToken) return null;
  const row = await db
    .prepare(
      'SELECT s.id, s.expires_at, s.id_token, u.id AS user_id, u.name, u.email, u.image FROM session s JOIN user u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?'
    )
    .bind(storedToken, new Date().toISOString())
    .first<{ id: string; expires_at: string; id_token: string | null; user_id: string; name: string; email: string; image: string | null }>();
  if (!row) return null;
  return {
    session: { id: row.id, expiresAt: row.expires_at, idToken: row.id_token },
    user: { id: row.user_id, name: row.name, email: row.email, image: row.image },
  };
}

export async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM session WHERE id = ?').bind(sessionId).run();
}

/** Cookie から、session テーブルの token 列の値（新しいセッションはハッシュ、Better Auth のものは平文）を得る */
async function sessionTokenFromCookies(
  cookies: Map<string, string>,
  legacySecret: string | undefined,
  secure: boolean
): Promise<string | null> {
  const token = cookies.get(cookieNames(secure).session);
  if (token) return sha256(token);
  if (!legacySecret) return null;
  for (const name of LEGACY_SESSION_COOKIES) {
    const value = cookies.get(name);
    if (value) return verifyLegacySessionCookie(decodeURIComponent(value), legacySecret);
  }
  return null;
}

/** Better Auth の Cookie の値（`<token>.<base64(HMAC-SHA256(secret, token))>`）を検証し、トークンを返す */
async function verifyLegacySessionCookie(value: string, secret: string): Promise<string | null> {
  const index = value.lastIndexOf('.');
  if (index <= 0) return null;
  const token = value.slice(0, index);
  let binary: string;
  try {
    binary = atob(value.slice(index + 1));
  } catch {
    return null;
  }
  const signature = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) signature[i] = binary.charCodeAt(i);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(token));
  return valid ? token : null;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
