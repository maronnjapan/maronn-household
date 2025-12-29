import { dbMiddleware } from "./db-middleware";
import { createTodoHandler } from "./create-todo-handler";
import { apply } from "@photonjs/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import expenses from "./routes/expenses";

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

  createTodoHandler,
]);

// 家計簿APIルート
app.route('/api/expenses', expenses);

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

export default app;
