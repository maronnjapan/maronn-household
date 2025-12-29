import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './types';
import expenses from './routes/expenses';

const app = new Hono<{ Bindings: Bindings }>();

// CORS設定 - 環境変数に基づいて制御
app.use('/*', (c, next) => {
  const isDevelopment = c.env.ENVIRONMENT === 'development';

  return cors({
    origin: isDevelopment ? '*' : c.env.ALLOWED_ORIGINS?.split(',') || [],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })(c, next);
});

// ルート
app.route('/expenses', expenses);

app.get('/', (c) => {
  return c.json({ message: 'Maronn Household API' });
});

// グローバルエラーハンドラー
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json(
    {
      error: 'Internal server error',
      message: c.env.ENVIRONMENT === 'development' ? err.message : undefined,
    },
    500
  );
});

export default app;
