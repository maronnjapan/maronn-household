/**
 * 支出一覧取得ツール
 * フィルタリング・ソート対応
 */

import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { expenses } from '@maronn/db-schema/household';

interface GetExpensesParams {
  month?: string;
  startDate?: string;
  endDate?: string;
  category?: string;
  limit?: number;
}

export async function getExpenses(
  db: D1Database,
  userId: string,
  params: GetExpensesParams,
) {
  const database = drizzle(db);
  const conditions = [eq(expenses.userId, userId)];

  if (params.month) {
    conditions.push(gte(expenses.date, `${params.month}-01`));
    conditions.push(lte(expenses.date, `${params.month}-31`));
  } else {
    if (params.startDate) {
      conditions.push(gte(expenses.date, params.startDate));
    }
    if (params.endDate) {
      conditions.push(lte(expenses.date, params.endDate));
    }
  }

  if (params.category) {
    conditions.push(eq(expenses.category, params.category));
  }

  const limit = params.limit ?? 100;

  const expensesList = await database
    .select()
    .from(expenses)
    .where(and(...conditions))
    .orderBy(desc(expenses.date))
    .limit(limit)
    .all();

  return {
    expenses: expensesList.map(e => ({
      id: e.id,
      amount: e.amount,
      category: e.category,
      memo: e.memo,
      date: e.date,
      createdAt: e.createdAt,
    })),
    count: expensesList.length,
    hasMore: expensesList.length === limit,
  };
}
