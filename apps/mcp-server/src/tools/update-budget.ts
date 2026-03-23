/**
 * 予算設定/更新ツール
 */

import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { budgets } from '@maronn/db-schema/household';
import { ulid } from 'ulidx';

interface UpdateBudgetParams {
  month: string;
  amount: number;
}

export async function updateBudget(
  db: D1Database,
  userId: string,
  params: UpdateBudgetParams,
) {
  if (params.amount < 0) {
    throw new Error('予算額は0以上である必要があります');
  }

  if (!/^\d{4}-\d{2}$/.test(params.month)) {
    throw new Error('月はYYYY-MM形式で指定してください');
  }

  const database = drizzle(db);
  const now = new Date().toISOString();

  const existingBudget = await database
    .select()
    .from(budgets)
    .where(and(eq(budgets.userId, userId), eq(budgets.month, params.month)))
    .get();

  if (existingBudget) {
    await database
      .update(budgets)
      .set({
        amount: Math.floor(params.amount),
        updatedAt: now,
      })
      .where(eq(budgets.id, existingBudget.id))
      .run();
  } else {
    await database
      .insert(budgets)
      .values({
        id: ulid(Date.now()),
        userId,
        month: params.month,
        amount: Math.floor(params.amount),
        updatedAt: now,
      })
      .run();
  }

  return {
    success: true,
    budget: {
      month: params.month,
      amount: Math.floor(params.amount),
      updatedAt: now,
    },
  };
}
