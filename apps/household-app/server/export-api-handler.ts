/**
 * 月次家計簿エクスポートAPI
 * Authorization: Bearer <token> で認証
 * 月3回の実行制限あり
 */

import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, lte } from 'drizzle-orm';
import { enhance, type Get, type UniversalHandler } from '@universal-middleware/core';
import { expenses, budgets, apiTokens, apiUsage } from '../database/drizzle/schema/household';
import { hashToken } from '../lib/api-token';

interface Env {
  DB: D1Database;
}

const MONTHLY_API_LIMIT = 3;

export const exportApiHandler = ((basePath: string) =>
  enhance(
    async (request, _context, runtime) => {
      const env = (runtime as { runtime: 'workerd'; env?: Env })?.env;

      if (!env) {
        return new Response(JSON.stringify({ error: 'Environment not available' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const url = new URL(request.url);
      const pathname = url.pathname;

      // パスの検証
      if (!pathname.startsWith(basePath)) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 認証ヘッダーの検証
      const authHeader = request.headers.get('Authorization');

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Authorization header missing or invalid' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const token = authHeader.replace('Bearer ', '');
      const tokenHash = await hashToken(token);

      // D1からトークンを検証
      const database = drizzle(env.DB);
      const tokenData = await database
        .select()
        .from(apiTokens)
        .where(eq(apiTokens.tokenHash, tokenHash))
        .get();

      if (!tokenData) {
        return new Response(JSON.stringify({ error: 'Invalid token' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (tokenData.isActive !== 1) {
        return new Response(JSON.stringify({ error: 'Token is revoked' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const userId = tokenData.userId;

      // ルーティング
      const subPath = pathname.slice(basePath.length);

      if (subPath === '/monthly' && request.method === 'GET') {
        return handleMonthlyExport(request, database, userId, tokenHash);
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    {
      name: 'household-app:export-api-handler',
      path: `${basePath}/**`,
      method: ['GET'],
      immutable: false,
    },
  )) satisfies Get<[basePath: string], UniversalHandler>;

async function handleMonthlyExport(
  request: Request,
  database: ReturnType<typeof drizzle>,
  userId: string,
  tokenHash: string,
): Promise<Response> {
  const url = new URL(request.url);
  const month = url.searchParams.get('month');

  // monthパラメータのバリデーション
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return new Response(
      JSON.stringify({ error: 'Invalid month parameter. Expected format: YYYY-MM' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  // 実行回数制限チェック
  const currentMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const usageId = `${userId}-${currentMonth}`;

  let usage = await database.select().from(apiUsage).where(eq(apiUsage.id, usageId)).get();

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

      return new Response(
        JSON.stringify({
          error: 'Monthly API usage limit exceeded',
          limit: MONTHLY_API_LIMIT,
          currentUsage: usage.count,
          retryAfter,
        }),
        {
          status: 403,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': retryAfter,
          },
        },
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
      and(eq(expenses.userId, userId), gte(expenses.date, startDate), lte(expenses.date, endDate)),
    )
    .all();

  // サマリー計算
  const totalExpenses = expensesList.reduce((sum, exp) => sum + exp.amount, 0);
  const budgetAmount = budget?.amount || 0;
  const remaining = budgetAmount - totalExpenses;

  return new Response(
    JSON.stringify({
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
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
