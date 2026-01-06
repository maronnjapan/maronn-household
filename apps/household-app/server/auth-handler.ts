import { enhance, type Get, type UniversalHandler } from "@universal-middleware/core";
import { createAuth } from "../auth/config";

/**
 * Better Auth用のハンドラー
 * /api/auth/* エンドポイントを処理
 */
export const authHandler = ((endpoint) =>
  enhance(
    async (request, context, runtime) => {
      const env = (runtime as { runtime: "workerd"; env?: any })?.env;

      if (!env) {
        return new Response("Environment not available", { status: 500 });
      }

      // Better Authインスタンスを作成（Hyperdrive経由でSupabaseに接続）
      const auth = createAuth(env);

      // Better Authのハンドラーを呼び出し
      return await auth.handler(request);
    },
    {
      name: "household-app:auth-handler",
      path: `${endpoint}/**`,
      method: ["GET", "POST"],
      immutable: false,
    },
  )) satisfies Get<[endpoint: string], UniversalHandler>;
