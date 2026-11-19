import { enhance, type Get, type UniversalHandler } from '@universal-middleware/core';
import { handleSessionRequest, type SessionEnv } from './session/handler';

/**
 * ログイン・ログアウト（認証基盤 household-auth の RP）のハンドラー
 * /api/session/* を処理する（実装は session/handler.ts）
 */
export const sessionHandler = ((endpoint) =>
  enhance(
    async (request, _context, runtime) => {
      const env = (runtime as { runtime: 'workerd'; env?: SessionEnv })?.env;
      if (!env) {
        return new Response('Environment not available', { status: 500 });
      }
      return handleSessionRequest(request, env);
    },
    {
      name: 'household-app:session-handler',
      path: `${endpoint}/**`,
      method: ['GET', 'POST'],
      immutable: false,
    }
  )) satisfies Get<[endpoint: string], UniversalHandler>;
