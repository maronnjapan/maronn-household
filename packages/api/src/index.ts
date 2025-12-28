import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './types';
import expenses from './routes/expenses';

const app = new Hono<{ Bindings: Bindings }>();

// CORS設定（開発時はすべて許可、本番では適切に設定）
app.use('/*', cors());

// ルート
app.route('/expenses', expenses);

app.get('/', (c) => {
  return c.json({ message: 'Maronn Household API' });
});

export default app;
