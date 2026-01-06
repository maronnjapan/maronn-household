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
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  NODE_ENV?: string;
}

export const trpcHandler = ((endpoint) =>
  enhance(
    async (request, context, runtime) => {
      const env = (runtime as { runtime: "workerd"; env?: Env })?.env;

      // Better Authからセッション情報を取得
      let session: Session | null = null;
      let user: User | null = null;

      if (!env) {
        throw new Error("Environment not available");
      }

      try {
        const auth = createAuth(env);
        const authSession = await auth.api.getSession({ headers: request.headers });

        if (authSession) {
          session = authSession.session;
          user = authSession.user;
        }
      } catch (error) {
        console.error('Error getting session:', error);

        // 開発環境では予期しない設定ミスなどを検知できるようにエラーを再スロー
        // 本番環境では未認証状態として扱う（セッション取得失敗を許容）
        const nodeEnv =
          (env && env.NODE_ENV) ||
          (typeof process !== "undefined" ? process.env?.NODE_ENV : undefined);
        if (nodeEnv && nodeEnv !== "production") {
          throw error;
        }
      }


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
            session,
            user,
            runtime,
            env,
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
