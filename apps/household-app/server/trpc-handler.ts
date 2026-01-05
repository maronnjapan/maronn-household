import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { enhance, type Get, type UniversalHandler } from "@universal-middleware/core";
import { appRouter } from "../trpc/server";
import { createAuth } from "../auth/config";

export const trpcHandler = ((endpoint) =>
  enhance(
    async (request, context, runtime) => {
      const env = (runtime as { runtime: "workerd"; env?: any })?.env;

      // Better Authからセッション情報を取得
      let session = null;
      let user = null;

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
