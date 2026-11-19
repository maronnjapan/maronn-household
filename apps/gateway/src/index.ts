/**
 * gateway: 全リクエストの入口になる Worker
 *
 * ドメインのルートはこの Worker だけが持ち、パスごとに service binding で各 Worker へ振り分ける。
 * 振り分け表は routes.ts を参照。
 */
import { rateLimitKey, resolveRoute, type Service } from './routes';

export type Env = Record<Service, Fetcher> & {
  /** 認証基盤の一部のパスの IP ごとのレート制限（wrangler.jsonc の ratelimits） */
  AUTH_RATE_LIMITER: RateLimit;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const decision = resolveRoute(url);

    if (decision.type === 'redirect') {
      return Response.redirect(decision.location, decision.status);
    }

    const limitKey = rateLimitKey(url, request.headers.get('CF-Connecting-IP') ?? 'unknown');
    if (limitKey && !(await env.AUTH_RATE_LIMITER.limit({ key: limitKey })).success) {
      return Response.json(
        { error: 'too_many_requests', error_description: 'しばらく待ってから再度お試しください' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }

    const target = env[decision.service];
    if (!decision.pathname) {
      return target.fetch(request);
    }
    url.pathname = decision.pathname;
    return target.fetch(new Request(url, request));
  },
};
