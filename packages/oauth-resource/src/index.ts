/**
 * household-auth が発行したアクセストークンで守る API（OAuth の保護リソース）の共通部品
 *
 * - RFC 9728 の保護リソースのメタデータ
 * - Bearer トークンの検証（RS256 の JWT、typ=at+jwt、iss、aud にこのリソース、スコープ）
 * - 失効の即時反映: 認証基盤が記録した発行済みトークン（access_tokens）にあるか確かめる
 * - 失敗時の WWW-Authenticate（resource_metadata と scope を示す）
 */
import type { Context, MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';

export interface ResourceEnv {
  DB: D1Database;
  /** household-auth への service binding（同じゾーンの URL への fetch は Worker を経由しないため） */
  AUTH: Fetcher;
  /** 認証基盤の issuer（= 公開オリジン） */
  ISSUER: string;
}

export interface AccessTokenCaller {
  userId: string;
  clientId: string;
}

export type ResourceContext = {
  Bindings: ResourceEnv;
  Variables: { caller: AccessTokenCaller };
};

/** isolate 内でキャッシュする JWKS（未知の kid なら jose が取り直す） */
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export function protectedResource(options: { path: string; scope: string }) {
  const resourceUrl = (env: ResourceEnv) => `${env.ISSUER}${options.path}`;
  const metadataUrl = (env: ResourceEnv) =>
    `${env.ISSUER}/.well-known/oauth-protected-resource${options.path}`;

  const challenge = (c: Context<ResourceContext>, status: 401 | 403) => {
    const error = status === 401 ? 'invalid_token' : 'insufficient_scope';
    const detail = status === 403 ? `error="${error}", ` : '';
    const header = `Bearer ${detail}resource_metadata="${metadataUrl(c.env)}", scope="${options.scope}"`;
    return c.json({ error }, status, { 'WWW-Authenticate': header });
  };

  const metadata = (c: Context<ResourceContext>) =>
    c.json({
      resource: resourceUrl(c.env),
      authorization_servers: [c.env.ISSUER],
      scopes_supported: [options.scope],
      bearer_methods_supported: ['header'],
    });

  const authenticate: MiddlewareHandler<ResourceContext> = async (c, next) => {
    const { ISSUER, AUTH, DB } = c.env;
    jwks ??= createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`), {
      [customFetch]: (url, init) => AUTH.fetch(url, init),
    });
    const token = /^Bearer (.+)$/.exec(c.req.header('Authorization') ?? '')?.[1];
    const verified = token
      ? await jwtVerify(token, jwks, {
          issuer: ISSUER,
          audience: resourceUrl(c.env),
          typ: 'at+jwt',
          algorithms: ['RS256'],
        }).catch(() => null)
      : null;
    const { sub, jti, scope, client_id: clientId } = verified?.payload ?? {};
    const issued =
      jti &&
      (await DB.prepare('SELECT 1 FROM access_tokens WHERE id = ? AND exp > ?')
        .bind(jti, Math.floor(Date.now() / 1000))
        .first());
    if (!sub || !issued) return challenge(c, 401);
    if (!String(scope).split(' ').includes(options.scope)) {
      return challenge(c, 403);
    }
    c.set('caller', { userId: sub, clientId: String(clientId) });
    await next();
  };

  return { metadata, authenticate };
}
