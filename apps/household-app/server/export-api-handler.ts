/**
 * 月次家計簿エクスポートAPI
 * Authorization: Bearer <token> で認証
 * 月3回の実行制限あり
 */

import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, lte } from 'drizzle-orm';
import { expenses, budgets, apiTokens, apiUsage } from '../database/drizzle/schema/household';
import { hashToken } from '../lib/api-token';
import { ulid } from 'ulidx';

interface Env {
  DB: D1Database;
}

const MONTHLY_API_LIMIT = 3;

export function exportApiHandler(basePath: string) {
  const app = new Hono<{ Bindings: Env }>();

  // 認証ミドルウェア
  app.use(`${basePath}/*`, async (c, next) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Authorization header missing or invalid' }, 401);
    }

    const token = authHeader.replace('Bearer ', '');
    const tokenHash = await hashToken(token);

    // D1からトークンを検証
    const database = drizzle(c.env.DB);
    const tokenData = await database
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.tokenHash, tokenHash))
      .get();

    if (!tokenData) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    if (tokenData.isActive !== 1) {
      return c.json({ error: 'Token is revoked' }, 401);
    }

    // コンテキストにユーザーIDを追加
    c.set('userId', tokenData.userId);
    c.set('tokenHash', tokenHash);

    await next();
  });

  // 月次エクスポートAPIエンドポイント
  app.get(`${basePath}/monthly`, async (c) => {
    const userId = c.get('userId') as string;
    const tokenHash = c.get('tokenHash') as string;
    const month = c.req.query('month');

    // monthパラメータのバリデーション
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return c.json(
        { error: 'Invalid month parameter. Expected format: YYYY-MM' },
        400
      );
    }

    const database = drizzle(c.env.DB);

    // 実行回数制限チェック
    const currentMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
    const usageId = `${userId}-${currentMonth}`;

    let usage = await database
      .select()
      .from(apiUsage)
      .where(eq(apiUsage.id, usageId))
      .get();

    if (!usage) {
      // 初回実行
      const now = new Date().toISOString();
      await database
        .insert(apiUsage)
        .values({
          id: usageId,
          userId,
          month: currentMonth,
          count: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      usage = { id: usageId, userId, month: currentMonth, count: 1, createdAt: now, updatedAt: now };
    } else {
      // 制限チェック
      if (usage.count >= MONTHLY_API_LIMIT) {
        const nextMonth = new Date(currentMonth + '-01');
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        const retryAfter = nextMonth.toISOString();

        return c.json(
          {
            error: 'Monthly API usage limit exceeded',
            limit: MONTHLY_API_LIMIT,
            currentUsage: usage.count,
            retryAfter,
          },
          403,
          { 'Retry-After': retryAfter }
        );
      }

      // カウントを増やす
      await database
        .update(apiUsage)
        .set({
          count: usage.count + 1,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(apiUsage.id, usageId))
        .run();

      usage.count += 1;
    }

    // lastUsedAtを更新
    await database
      .update(apiTokens)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(apiTokens.tokenHash, tokenHash))
      .run();

    // 予算を取得
    const budget = await database
      .select()
      .from(budgets)
      .where(and(eq(budgets.userId, userId), eq(budgets.month, month)))
      .get();

    // 支出を取得
    const startDate = `${month}-01`;
    const endDate = `${month}-31`;

    const expensesList = await database
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

    // サマリー計算
    const totalExpenses = expensesList.reduce((sum, exp) => sum + exp.amount, 0);
    const budgetAmount = budget?.amount || 0;
    const remaining = budgetAmount - totalExpenses;

    return c.json({
      month,
      budget: budget
        ? {
            amount: budget.amount,
            updatedAt: budget.updatedAt,
          }
        : null,
      expenses: expensesList.map((exp) => ({
        id: exp.id,
        amount: exp.amount,
        category: exp.category,
        memo: exp.memo,
        date: exp.date,
        createdAt: exp.createdAt,
      })),
      summary: {
        totalExpenses,
        remaining,
        expenseCount: expensesList.length,
      },
      apiUsage: {
        currentMonthUsage: usage.count,
        limit: MONTHLY_API_LIMIT,
        remaining: MONTHLY_API_LIMIT - usage.count,
      },
    });
  });

  return app;
}
