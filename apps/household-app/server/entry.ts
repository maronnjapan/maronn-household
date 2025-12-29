import { dbMiddleware } from "./db-middleware";
import { trpcHandler } from "./trpc-handler";
import { apply, serve } from "@photonjs/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

export default startApp() as unknown;

function startApp() {
  const app = new Hono();

  // CORS設定
  app.use('/*', (c, next) => {
    const isDevelopment = process.env.NODE_ENV === 'development';

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

    // tRPC route. See https://trpc.io/docs/server/adapters
    trpcHandler("/api/trpc"),
  ]);

  // グローバルエラーハンドラー
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json(
      {
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined,
      },
      500
    );
  });

  return serve(app, {
    port,
  });
}
