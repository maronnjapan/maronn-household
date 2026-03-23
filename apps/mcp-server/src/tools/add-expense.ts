/**
 * 支出追加ツール
 */

import { drizzle } from 'drizzle-orm/d1';
import { expenses } from '@maronn/db-schema/household';
import { ulid } from 'ulidx';

interface AddExpenseParams {
  amount: number;
  category?: string;
  memo?: string;
  date?: string;
}

export async function addExpense(
  db: D1Database,
  userId: string,
  params: AddExpenseParams,
) {
  if (params.amount <= 0) {
    throw new Error('金額は正の数である必要があります');
  }

  const database = drizzle(db);
  const now = new Date().toISOString();
  const expenseId = ulid(Date.now());
  const expenseDate = params.date ?? now.slice(0, 10);
  const deviceId = `mcp-${expenseId}`;

  await database
    .insert(expenses)
    .values({
      id: expenseId,
      userId,
      amount: Math.floor(params.amount),
      category: params.category ?? null,
      memo: params.memo ?? null,
      date: expenseDate,
      createdAt: now,
      updatedAt: now,
      deviceId,
    })
    .run();

  return {
    success: true,
    expense: {
      id: expenseId,
      amount: Math.floor(params.amount),
      category: params.category ?? null,
      memo: params.memo ?? null,
      date: expenseDate,
      createdAt: now,
    },
  };
}
