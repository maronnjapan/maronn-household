/**
 * gateway: 全リクエストの入口になる Worker
 *
 * ドメインのルートはこの Worker だけが持ち、パスごとに service binding で各 Worker へ振り分ける。
 * 振り分け表は routes.ts を参照。
 */
import { rateLimitKey, resolveRoute, type RateLimiterName, type Service } from './routes';

/** 振り分け先の service binding と、IP ごとのレート制限（wrangler.jsonc の ratelimits） */
export type Env = Record<Service, Fetcher> & Record<RateLimiterName, RateLimit>;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const decision = resolveRoute(url);

    if (decision.type === 'redirect') {
      return Response.redirect(decision.location, decision.status);
    }

    const limit = rateLimitKey(url, request.headers.get('CF-Connecting-IP') ?? 'unknown');
    if (limit && !(await env[limit.limiter].limit({ key: limit.key })).success) {
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
