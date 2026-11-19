import { describe, it, expect } from 'vitest';
import { rateLimitKey, resolveRoute } from '../src/routes';

const route = (path: string, host = 'maronn-household-budget.com') =>
  resolveRoute(new URL(`https://${host}${path}`));

describe('resolveRoute', () => {
  it.each([
    '/authorize',
    '/token',
    '/userinfo',
    '/login',
    '/login/google',
    '/consent',
    '/register',
    '/revoke',
    '/introspect',
    '/logout',
    '/.well-known/openid-configuration',
    '/.well-known/jwks.json',
    '/api/auth/callback/google',
  ])('認証基盤のパス %s は AUTH に振り分ける', (path) => {
    expect(route(path)).toEqual({ type: 'forward', service: 'AUTH' });
  });

  it.each(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/'])(
    'RFC 8414 のメタデータ %s は OIDC Discovery に書き換えて AUTH に振り分ける',
    (path) => {
      expect(route(path)).toEqual({
        type: 'forward',
        service: 'AUTH',
        pathname: '/.well-known/openid-configuration',
      });
    }
  );

  it.each([
    '/mcp',
    '/mcp/',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
  ])('MCP のパス %s は MCP に振り分ける', (path) => {
    expect(route(path)).toEqual({ type: 'forward', service: 'MCP' });
  });

  it.each([
    '/',
    '/household',
    '/household/budget',
    '/calendar',
    '/settings',
    '/auth/login',
    '/api/trpc/getExpenses',
    '/api/session',
    '/api/session/callback',
    '/api/v1/export/expenses',
    '/assets/static/index.css',
    '/loginx',
    '/tokens',
    '/mcpx',
    '/api/auth/session',
    // 認証基盤の内部エンドポイント（アカウント削除）は公開経路から届かない
    '/internal/users/delete',
  ])('それ以外のパス %s はアプリ（APP）に振り分ける', (path) => {
    expect(route(path)).toEqual({ type: 'forward', service: 'APP' });
  });

  it('www 付きのホストはパスとクエリを保ったまま apex に 301 リダイレクトする', () => {
    expect(route('/household?x=1', 'www.maronn-household-budget.com')).toEqual({
      type: 'redirect',
      location: 'https://maronn-household-budget.com/household?x=1',
      status: 301,
    });
  });
});

describe('レート制限の対象', () => {
  it.each(['/register', '/authorize', '/api/session/login'])('%s は IP ごとのレート制限の対象', (path) => {
    expect(rateLimitKey(new URL(`https://maronn-household-budget.com${path}`), '203.0.113.1')).toBe(`203.0.113.1:${path}`);
  });

  it.each(['/token', '/household', '/mcp', '/login'])('%s は対象外', (path) => {
    expect(rateLimitKey(new URL(`https://maronn-household-budget.com${path}`), '203.0.113.1')).toBeNull();
  });
});
