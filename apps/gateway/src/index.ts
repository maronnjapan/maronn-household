/**
 * gateway: 全リクエストの入口になる Worker
 *
 * ドメインのルートはこの Worker だけが持ち、パスごとに service binding で各 Worker へ振り分ける。
 * 振り分け表は routes.ts を参照。
 */
import { resolveRoute, type Service } from './routes';

export type Env = Record<Service, Fetcher>;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const decision = resolveRoute(url);

    if (decision.type === 'redirect') {
      return Response.redirect(decision.location, decision.status);
    }

    const target = env[decision.service];
    if (!decision.pathname) {
      return target.fetch(request);
    }
    url.pathname = decision.pathname;
    return target.fetch(new Request(url, request));
  },
};
