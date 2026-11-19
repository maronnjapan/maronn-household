/**
 * gateway の振り分け表
 *
 * 単一ホスト（maronn-household-budget.com）で、パスごとに転送先の Worker を決める。
 * 認証基盤（maronn-openid-connect の生成コード）のルートはオリジン直下に固定なので、
 * そのパスをそのまま AUTH に渡す。
 */

export type Service = 'AUTH' | 'MCP' | 'APP';

export type RouteDecision =
  | { type: 'forward'; service: Service; pathname?: string }
  | { type: 'redirect'; location: string; status: 301 };

/** OIDC Provider（apps/auth-server）が持つパス */
const AUTH_PATHS = new Set([
  '/authorize',
  '/token',
  '/userinfo',
  '/login',
  '/consent',
  '/register',
  '/revoke',
  '/introspect',
  '/logout',
  '/.well-known/openid-configuration',
  '/.well-known/jwks.json',
  // Google 上流ログインのコールバック（Google Cloud Console に登録済みのURIを引き継ぐ）
  '/api/auth/callback/google',
]);

/** 前方一致で AUTH に渡すパス（ログイン方法ごとのサブパス、ログアウトの確認 /logout/approve） */
const AUTH_PREFIXES = ['/login/', '/logout/'];

/** RFC 8414 のメタデータ。生成OPは OIDC Discovery しか持たないので、同じ文書に書き換える */
const OAUTH_AS_METADATA_PATH = '/.well-known/oauth-authorization-server';
const OIDC_DISCOVERY_PATH = '/.well-known/openid-configuration';

const MCP_PATH = '/mcp';
const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';

const WWW_PREFIX = 'www.';

export function resolveRoute(url: URL): RouteDecision {
  if (url.hostname.startsWith(WWW_PREFIX)) {
    const location = new URL(url);
    location.hostname = url.hostname.slice(WWW_PREFIX.length);
    return { type: 'redirect', location: location.toString(), status: 301 };
  }

  const path = url.pathname;

  if (AUTH_PATHS.has(path) || AUTH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return { type: 'forward', service: 'AUTH' };
  }
  if (isPathOrChild(path, OAUTH_AS_METADATA_PATH)) {
    return { type: 'forward', service: 'AUTH', pathname: OIDC_DISCOVERY_PATH };
  }
  if (isPathOrChild(path, MCP_PATH) || isPathOrChild(path, PROTECTED_RESOURCE_METADATA_PATH)) {
    return { type: 'forward', service: 'MCP' };
  }
  return { type: 'forward', service: 'APP' };
}

function isPathOrChild(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/** IP ごとにレート制限するパス（未認証で D1 に書き込ませるもの） */
const RATE_LIMITED_PATHS = new Set(['/register', '/authorize', '/api/session/login']);

/**
 * レート制限のキー（対象外のパスは null）
 * 動的クライアント登録・認可リクエスト・アプリのログイン開始（いずれも D1 への書き込み）の乱発を抑える
 */
export function rateLimitKey(url: URL, clientIp: string): string | null {
  return RATE_LIMITED_PATHS.has(url.pathname) ? `${clientIp}:${url.pathname}` : null;
}
