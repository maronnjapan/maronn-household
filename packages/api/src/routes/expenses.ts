import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import type { Bindings } from '../types';
import { expenses } from '../db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

const app = new Hono<{ Bindings: Bindings }>();

// POST /expenses - 支出を保存
app.post('/', async (c) => {
  try {
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
  } catch (error) {
    console.error('Error saving expense:', error);
    return c.json({ error: 'Failed to save expense' }, 500);
  }
});

// GET /expenses - 支出を取得（月別または全件）
app.get('/', async (c) => {
  try {
    const month = c.req.query('month'); // YYYY-MM 形式
    const db = drizzle(c.env.DB);
    const userId = 'default-user';

    let query = db.select().from(expenses);

    if (month) {
      // 月指定がある場合は範囲検索
      const startDate = `${month}-01`;
      const endDate = `${month}-31`; // 簡易的な実装

      const results = await query
        .where(
          and(
            eq(expenses.userId, userId),
            gte(expenses.date, startDate),
            lte(expenses.date, endDate)
          )
        )
        .all();

      return c.json({ expenses: results });
    }

    // 全件取得
    const results = await query.where(eq(expenses.userId, userId)).all();

    return c.json({ expenses: results });
  } catch (error) {
    console.error('Error fetching expenses:', error);
    return c.json({ error: 'Failed to fetch expenses' }, 500);
  }
});

export default app;
