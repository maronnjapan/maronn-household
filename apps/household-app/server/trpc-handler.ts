import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import {
  enhance,
  type Get,
  type UniversalHandler,
} from '@universal-middleware/core';
import { appRouter, type Env } from '../trpc/server';
import { findSessionUser } from './session/store';

export const trpcHandler = ((endpoint) =>
  enhance(
    async (request, context, runtime) => {
      const env = (runtime as { runtime: 'workerd'; env?: Env })?.env;
      if (!env) {
        throw new Error('Environment not available');
      }

      // セッション（認証基盤でログインしたユーザー）を D1 から取得する
      const current = await findSessionUser(
        env.DB,
        request.headers.get('Cookie'),
        env.BETTER_AUTH_SECRET,
        env.OIDC_ISSUER.startsWith('https://')
      );

      return fetchRequestHandler({
        endpoint,
        req: request,
        router: appRouter,
        createContext({ req, resHeaders }) {
          // コンテキスト展開を明示的に行い、プロパティの衝突を防ぐ
          return {
            ...context,
            req,
            resHeaders,
            session: current?.session ?? null,
            user: current?.user ?? null,
            runtime,
            env,
          };
        },
      });
    },
    {
      name: 'household-app:trpc-handler',
      path: `${endpoint}/**`,
      method: ['GET', 'POST'],
      immutable: false,
    }
  )) satisfies Get<[endpoint: string], UniversalHandler>;
