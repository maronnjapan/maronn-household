import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { enhance, type Get, type UniversalHandler } from "@universal-middleware/core";
import { appRouter } from "../trpc/server";
import { createAuth } from "../auth/config";
import type { Session, User } from "better-auth/types";

/**
 * Cloudflare Workers環境変数の型定義
 */
interface Env {
  DB: D1Database;
  HYPERDRIVE: Hyperdrive;
  AUTH0_DOMAIN: string;
  AUTH0_CLIENT_ID: string;
  AUTH0_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}

export const trpcHandler = ((endpoint) =>
  enhance(
    async (request, context, runtime) => {
      const env = (runtime as { runtime: "workerd"; env?: Env })?.env;

      // Better Authからセッション情報を取得
      let session: Session | null = null;
      let user: User | null = null;

      if (env) {
        try {
          const auth = createAuth(env);
          const authSession = await auth.api.getSession({ headers: request.headers });

          if (authSession) {
            session = authSession.session;
            user = authSession.user;
          }
        } catch (error) {
          console.error('Error getting session:', error);
          // セッション取得失敗は許容（未認証状態として扱う）
        }
      }

      return fetchRequestHandler({
        endpoint,
        req: request,
        router: appRouter,
        createContext({ req, resHeaders }) {
          return {
            ...context,
            ...runtime,
            req,
            resHeaders,
            session,
            user,
          };
        },
      });
    },
    {
      name: "household-app:trpc-handler",
      path: `${endpoint}/**`,
      method: ["GET", "POST"],
      immutable: false,
    },
  )) satisfies Get<[endpoint: string], UniversalHandler>;
