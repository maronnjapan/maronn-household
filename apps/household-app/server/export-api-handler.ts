/**
 * 月次家計簿エクスポートAPI
 * Authorization: Bearer <token> で認証
 * 1日50回の実行制限あり
 */

import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, lte } from 'drizzle-orm';
import { enhance, type Get, type Post, type Put, type UniversalHandler } from '@universal-middleware/core';
import { expenses, budgets, apiTokens, apiUsage } from '../database/drizzle/schema/household';
import { hashToken } from '../lib/api-token';
import { ulid } from 'ulidx';

interface Env {
  DB: D1Database;
}

const DAILY_API_LIMIT = 50;

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

      if (subPath === '/expenses' && request.method === 'POST') {
        return handleAddExpense(request, database, userId, tokenHash);
      }

      if (subPath === '/budget' && request.method === 'PUT') {
        return handleUpdateBudget(request, database, userId, tokenHash);
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    {
      name: 'household-app:export-api-handler',
      path: `${basePath}/**`,
      method: ['GET', 'POST', 'PUT'],
      immutable: false,
    },
  )) satisfies UniversalHandler;

/**
 * 1日のAPI使用回数をチェックして増加させる
 */
async function checkAndIncrementDailyUsage(
  database: ReturnType<typeof drizzle>,
  userId: string,
): Promise<{
  usage?: { id: string; userId: string; month: string; count: number; createdAt: string; updatedAt: string };
  error?: Response;
}> {
  const currentDate = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  const usageId = `${userId}-${currentDate}`;

  let usage = await database.select().from(apiUsage).where(eq(apiUsage.id, usageId)).get();

  if (!usage) {
    // 初回実行
    const now = new Date().toISOString();
    await database
      .insert(apiUsage)
      .values({
        id: usageId,
        userId,
        month: currentDate, // 日付を保存（カラム名はmonthだが日付を格納）
        count: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    usage = { id: usageId, userId, month: currentDate, count: 1, createdAt: now, updatedAt: now };
  } else {
    // 制限チェック
    if (usage.count >= DAILY_API_LIMIT) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const retryAfter = tomorrow.toISOString();

      return {
        error: new Response(
          JSON.stringify({
            error: 'Daily API usage limit exceeded',
            limit: DAILY_API_LIMIT,
            currentUsage: usage.count,
            retryAfter,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': retryAfter,
            },
          },
        ),
      };
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

  return { usage };
}

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

  // 実行回数制限チェック（1日50回）
  const checkResult = await checkAndIncrementDailyUsage(database, userId);
  if (checkResult.error) {
    return checkResult.error;
  }
  const usage = checkResult.usage!;

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
        currentDayUsage: usage.count,
        limit: DAILY_API_LIMIT,
        remaining: DAILY_API_LIMIT - usage.count,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

/**
 * 支出を追加するエンドポイント
 */
async function handleAddExpense(
  request: Request,
  database: ReturnType<typeof drizzle>,
  userId: string,
  tokenHash: string,
): Promise<Response> {
  // リクエストボディの取得
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // バリデーション
  if (!body || typeof body !== 'object') {
    return new Response(JSON.stringify({ error: 'Request body must be an object' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { amount, category, memo, date, deviceId } = body as {
    amount?: unknown;
    category?: unknown;
    memo?: unknown;
    date?: unknown;
    deviceId?: unknown;
  };

  // 必須フィールドのチェック
  if (typeof amount !== 'number' || amount <= 0) {
    return new Response(
      JSON.stringify({ error: 'Invalid amount. Must be a positive number' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  // オプションフィールドの検証
  if (category !== undefined && typeof category !== 'string') {
    return new Response(JSON.stringify({ error: 'category must be a string' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (memo !== undefined && typeof memo !== 'string') {
    return new Response(JSON.stringify({ error: 'memo must be a string' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (date !== undefined && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    return new Response(
      JSON.stringify({ error: 'date must be in YYYY-MM-DD format' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  if (deviceId !== undefined && typeof deviceId !== 'string') {
    return new Response(JSON.stringify({ error: 'deviceId must be a string' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // レート制限チェック
  const checkResult = await checkAndIncrementDailyUsage(database, userId);
  if (checkResult.error) {
    return checkResult.error;
  }

  // 支出データの作成
  const now = new Date().toISOString();
  const expenseId = ulid(Date.now());
  const expenseDate = date || now.slice(0, 10);
  const expenseDeviceId = deviceId || `api-${expenseId}`;

  try {
    await database
      .insert(expenses)
      .values({
        id: expenseId,
        userId,
        amount: Math.floor(amount),
        category: category || null,
        memo: memo || null,
        date: expenseDate,
        createdAt: now,
        updatedAt: now,
        deviceId: expenseDeviceId,
      })
      .run();

    // lastUsedAtを更新
    await database
      .update(apiTokens)
      .set({ lastUsedAt: now })
      .where(eq(apiTokens.tokenHash, tokenHash))
      .run();

    const usage = checkResult.usage!;

    return new Response(
      JSON.stringify({
        success: true,
        expense: {
          id: expenseId,
          amount: Math.floor(amount),
          category: category || null,
          memo: memo || null,
          date: expenseDate,
          createdAt: now,
        },
        apiUsage: {
          currentDayUsage: usage.count,
          limit: DAILY_API_LIMIT,
          remaining: DAILY_API_LIMIT - usage.count,
        },
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('Failed to insert expense:', error);
    return new Response(JSON.stringify({ error: 'Failed to create expense' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * 予算を設定/更新するエンドポイント
 */
async function handleUpdateBudget(
  request: Request,
  database: ReturnType<typeof drizzle>,
  userId: string,
  tokenHash: string,
): Promise<Response> {
  // リクエストボディの取得
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // バリデーション
  if (!body || typeof body !== 'object') {
    return new Response(JSON.stringify({ error: 'Request body must be an object' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { month, amount } = body as {
    month?: unknown;
    amount?: unknown;
  };

  // 必須フィールドのチェック
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    return new Response(
      JSON.stringify({ error: 'Invalid month. Expected format: YYYY-MM' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  if (typeof amount !== 'number' || amount < 0) {
    return new Response(
      JSON.stringify({ error: 'Invalid amount. Must be a non-negative number' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  // レート制限チェック
  const checkResult = await checkAndIncrementDailyUsage(database, userId);
  if (checkResult.error) {
    return checkResult.error;
  }

  const now = new Date().toISOString();

  try {
    // 既存の予算を確認
    const existingBudget = await database
      .select()
      .from(budgets)
      .where(and(eq(budgets.userId, userId), eq(budgets.month, month)))
      .get();

    if (existingBudget) {
      // 更新
      await database
        .update(budgets)
        .set({
          amount: Math.floor(amount),
          updatedAt: now,
        })
        .where(eq(budgets.id, existingBudget.id))
        .run();
    } else {
      // 新規作成
      const budgetId = ulid(Date.now());
      await database
        .insert(budgets)
        .values({
          id: budgetId,
          userId,
          month,
          amount: Math.floor(amount),
          updatedAt: now,
        })
        .run();
    }

    // lastUsedAtを更新
    await database
      .update(apiTokens)
      .set({ lastUsedAt: now })
      .where(eq(apiTokens.tokenHash, tokenHash))
      .run();

    const usage = checkResult.usage!;

    return new Response(
      JSON.stringify({
        success: true,
        budget: {
          month,
          amount: Math.floor(amount),
          updatedAt: now,
        },
        apiUsage: {
          currentDayUsage: usage.count,
          limit: DAILY_API_LIMIT,
          remaining: DAILY_API_LIMIT - usage.count,
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('Failed to update budget:', error);
    return new Response(JSON.stringify({ error: 'Failed to update budget' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
