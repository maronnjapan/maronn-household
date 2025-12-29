import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, lte } from 'drizzle-orm';
import { expenses } from '../../database/drizzle/schema/household';

const app = new Hono();

// POST /expenses - 支出を保存
app.post('/', async (c) => {
  const body = await c.req.json();
  const { id, amount, category, memo, date, createdAt, updatedAt, deviceId } =
    body;

  // バリデーション
  if (!id || !amount || !date || !createdAt || !updatedAt || !deviceId) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const db = drizzle(c.env.DB);

  // 認証未実装のため、デフォルトユーザーを使用
  const userId = 'default-user';

  // 既存データをチェック（重複登録防止）
  const existing = await db
    .select()
    .from(expenses)
    .where(eq(expenses.id, id))
    .get();

  if (existing) {
    // 既に存在する場合はupdatedAtで更新判定
    if (new Date(existing.updatedAt) < new Date(updatedAt)) {
      await db
        .update(expenses)
        .set({
          amount,
          category: category || null,
          memo: memo || null,
          date,
          updatedAt,
          deviceId,
        })
        .where(eq(expenses.id, id))
        .run();

      return c.json({ success: true, updated: true });
    }

    return c.json({ success: true, updated: false, message: 'Already up to date' });
  }

  // 新規挿入
  await db
    .insert(expenses)
    .values({
      id,
      userId,
      amount,
      category: category || null,
      memo: memo || null,
      date,
      createdAt,
      updatedAt,
      deviceId,
    })
    .run();

  return c.json({ success: true, created: true });
});

// GET /expenses - 支出を取得（月別のみ）
app.get('/', async (c) => {
  // month パラメータが指定されていない場合は現在の月を使用
  let month = c.req.query('month');
  if (!month) {
    const now = new Date();
    const year = now.getFullYear();
    const monthNum = String(now.getMonth() + 1).padStart(2, '0');
    month = `${year}-${monthNum}`;
  }

  const db = drizzle(c.env.DB);
  const userId = 'default-user';

  // 月の範囲を計算
  const startDate = `${month}-01`;
  const endDate = `${month}-31`; // 簡易的な実装

  const results = await db
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.userId, userId),
        gte(expenses.date, startDate),
        lte(expenses.date, endDate)
      )
    )
    .all();

  return c.json({ expenses: results, month });
});

export default app;
