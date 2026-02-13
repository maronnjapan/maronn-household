import { dbMiddleware } from "./db-middleware";
import { trpcHandler } from "./trpc-handler";
import { authHandler } from "./auth-handler";
import { exportApiHandler } from "./export-api-handler";
import { adminRotateSecretKeyHandler } from "./admin-rotate-secret-key-handler";
import { apply, serve } from "@photonjs/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

export default startApp() as unknown;

function startApp() {
  const app = new Hono();

  // CORS設定
  app.use('/*', (c, next) => {
    // Cloudflare Workers環境では env を通じて環境変数にアクセス
    const env = c.env as { NODE_ENV?: string } | undefined;
    const nodeEnv = env?.NODE_ENV || 'production';
    const isDevelopment = nodeEnv === 'development';

    return cors({
      origin: isDevelopment ? '*' : [],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    })(c, next);
  });

  apply(app, [
    // Make database available in Context as `context.db`
    dbMiddleware,

    // Better Auth endpoints
    authHandler("/api/auth"),

    // tRPC route. See https://trpc.io/docs/server/adapters
    trpcHandler("/api/trpc"),

    // Export API endpoints (token-based authentication)
    exportApiHandler("/api/v1/export"),

    // Admin: secret key rotation (admin-only, requires WEBHOOK_SECRET_KEY_OLD)
    adminRotateSecretKeyHandler("/api/admin/rotate-secret-key"),
  ]);

  // グローバルエラーハンドラー
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    const env = c.env as { NODE_ENV?: string } | undefined;
    const nodeEnv = env?.NODE_ENV || 'production';
    const isDevelopment = nodeEnv === 'development';

    return c.json(
      {
        error: 'Internal server error',
        message: isDevelopment ? err.message : undefined,
        stack: isDevelopment ? err.stack : undefined,
      },
      500
    );
  });

  // Cloudflare Workers環境では serve() を使う
  // ローカル開発時はポートを指定、本番環境では指定しない
  const isLocal = typeof process !== 'undefined' && process.env?.NODE_ENV;
  if (isLocal) {
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    return serve(app, { port });
  }

  return serve(app);
}
