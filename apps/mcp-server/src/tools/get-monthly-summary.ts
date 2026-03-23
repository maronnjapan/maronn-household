/**
 * 月次サマリー取得ツール
 * 指定月の予算・支出・残額をまとめて返す
 */

import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, lte } from 'drizzle-orm';
import { expenses, budgets, subBudgets, subBudgetMonthlyAmounts } from '@maronn/db-schema/household';
import { calculateRemaining, calculateRemainingDays, calculateDailyLimit, calculateBudgetPaceComparison } from '@maronn/domain/budget';

interface GetMonthlySummaryParams {
  month: string;
}

export async function getMonthlySummary(
  db: D1Database,
  userId: string,
  params: GetMonthlySummaryParams,
) {
  const { month } = params;
  const database = drizzle(db);

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

  // サブ予算を取得
  const subBudgetsList = await database
    .select()
    .from(subBudgets)
    .where(eq(subBudgets.userId, userId))
    .all();

  const subBudgetAmounts = await database
    .select()
    .from(subBudgetMonthlyAmounts)
    .where(and(eq(subBudgetMonthlyAmounts.userId, userId), eq(subBudgetMonthlyAmounts.month, month)))
    .all();

  // 計算
  const budgetAmount = budget?.amount ?? 0;
  const expenseAmounts = expensesList.map(e => ({ amount: e.amount }));
  const totalSpent = expensesList.reduce((sum, e) => sum + e.amount, 0);
  const remaining = calculateRemaining(budgetAmount, expenseAmounts);
  const remainingDays = calculateRemainingDays(month);
  const dailyLimit = calculateDailyLimit(remaining, month);
  const paceComparison = calculateBudgetPaceComparison(budgetAmount, expenseAmounts, month);

  // カテゴリ別集計
  const categoryBreakdown: Record<string, { total: number; count: number }> = {};
  for (const expense of expensesList) {
    const cat = expense.category || '未分類';
    if (!categoryBreakdown[cat]) {
      categoryBreakdown[cat] = { total: 0, count: 0 };
    }
    categoryBreakdown[cat].total += expense.amount;
    categoryBreakdown[cat].count += 1;
  }

  // サブ予算情報
  const subBudgetSummaries = subBudgetsList.map(sb => {
    const monthlyAmount = subBudgetAmounts.find(a => a.subBudgetId === sb.id);
    const amount = monthlyAmount?.amount ?? sb.amount;
    const subExpenses = expensesList.filter(e => e.subBudgetId === sb.id);
    const subSpent = subExpenses.reduce((sum, e) => sum + e.amount, 0);
    return {
      name: sb.name,
      budget: amount,
      spent: subSpent,
      remaining: amount - subSpent,
    };
  });

  return {
    month,
    budget: budgetAmount,
    totalSpent,
    remaining,
    remainingDays,
    dailyLimit: Math.round(dailyLimit),
    paceComparison: Math.round(paceComparison),
    paceStatus: paceComparison >= 0 ? '予算内で順調' : '使いすぎペース',
    expenseCount: expensesList.length,
    categoryBreakdown,
    subBudgets: subBudgetSummaries.length > 0 ? subBudgetSummaries : undefined,
  };
}
