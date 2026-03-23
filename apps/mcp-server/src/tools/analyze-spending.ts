/**
 * 支出分析ツール
 * 期間を指定して支出傾向を分析する
 */

import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, lte } from 'drizzle-orm';
import { expenses, budgets } from '@maronn/db-schema/household';

interface AnalyzeSpendingParams {
  startMonth: string;
  endMonth: string;
}

interface MonthlyData {
  month: string;
  budget: number;
  spent: number;
  remaining: number;
  expenseCount: number;
  categoryBreakdown: Record<string, number>;
}

export async function analyzeSpending(
  db: D1Database,
  userId: string,
  params: AnalyzeSpendingParams,
) {
  const database = drizzle(db);

  // 期間内の支出を取得
  const startDate = `${params.startMonth}-01`;
  const endDate = `${params.endMonth}-31`;

  const expensesList = await database
    .select()
    .from(expenses)
    .where(
      and(eq(expenses.userId, userId), gte(expenses.date, startDate), lte(expenses.date, endDate)),
    )
    .all();

  // 期間内の予算を取得
  const budgetsList = await database
    .select()
    .from(budgets)
    .where(
      and(
        eq(budgets.userId, userId),
        gte(budgets.month, params.startMonth),
        lte(budgets.month, params.endMonth),
      ),
    )
    .all();

  const budgetMap = new Map(budgetsList.map(b => [b.month, b.amount]));

  // 月別集計
  const monthlyMap = new Map<string, MonthlyData>();

  for (const expense of expensesList) {
    const month = expense.date.slice(0, 7);
    if (!monthlyMap.has(month)) {
      const budgetAmount = budgetMap.get(month) ?? 0;
      monthlyMap.set(month, {
        month,
        budget: budgetAmount,
        spent: 0,
        remaining: budgetAmount,
        expenseCount: 0,
        categoryBreakdown: {},
      });
    }

    const data = monthlyMap.get(month)!;
    data.spent += expense.amount;
    data.remaining = data.budget - data.spent;
    data.expenseCount += 1;

    const cat = expense.category || '未分類';
    data.categoryBreakdown[cat] = (data.categoryBreakdown[cat] ?? 0) + expense.amount;
  }

  const monthlyData = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  // 全体のカテゴリ別集計
  const totalCategoryBreakdown: Record<string, { total: number; count: number; average: number }> = {};
  for (const expense of expensesList) {
    const cat = expense.category || '未分類';
    if (!totalCategoryBreakdown[cat]) {
      totalCategoryBreakdown[cat] = { total: 0, count: 0, average: 0 };
    }
    totalCategoryBreakdown[cat].total += expense.amount;
    totalCategoryBreakdown[cat].count += 1;
  }
  for (const cat of Object.keys(totalCategoryBreakdown)) {
    const data = totalCategoryBreakdown[cat];
    data.average = Math.round(data.total / data.count);
  }

  // 全体統計
  const totalSpent = expensesList.reduce((sum, e) => sum + e.amount, 0);
  const totalBudget = budgetsList.reduce((sum, b) => sum + b.amount, 0);
  const monthCount = monthlyData.length || 1;
  const averageMonthlySpent = Math.round(totalSpent / monthCount);

  // 日別の支出パターン分析（曜日別）
  const dayOfWeekSpending: Record<string, { total: number; count: number }> = {
    '日': { total: 0, count: 0 },
    '月': { total: 0, count: 0 },
    '火': { total: 0, count: 0 },
    '水': { total: 0, count: 0 },
    '木': { total: 0, count: 0 },
    '金': { total: 0, count: 0 },
    '土': { total: 0, count: 0 },
  };
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

  for (const expense of expensesList) {
    const date = new Date(expense.date);
    const dayName = dayNames[date.getDay()];
    dayOfWeekSpending[dayName].total += expense.amount;
    dayOfWeekSpending[dayName].count += 1;
  }

  const dayOfWeekAverages: Record<string, number> = {};
  for (const [day, data] of Object.entries(dayOfWeekSpending)) {
    dayOfWeekAverages[day] = data.count > 0 ? Math.round(data.total / data.count) : 0;
  }

  return {
    period: {
      startMonth: params.startMonth,
      endMonth: params.endMonth,
    },
    overview: {
      totalBudget,
      totalSpent,
      totalRemaining: totalBudget - totalSpent,
      averageMonthlySpent,
      totalExpenseCount: expensesList.length,
    },
    monthlyBreakdown: monthlyData,
    categoryAnalysis: totalCategoryBreakdown,
    dayOfWeekPattern: dayOfWeekAverages,
  };
}
