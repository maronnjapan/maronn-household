import { useLiveQuery } from 'dexie-react-hooks';
import type { ExpenseEntity } from '@maronn/domain';
import { getExpensesByMonth, mergeExpensesFromServer } from '../lib/db';
import { trpc } from '../trpc/client';

export interface DayExpenses {
  date: string; // 'YYYY-MM-DD'
  expenses: ExpenseEntity[];
  total: number;
}

export interface CalendarExpensesResult {
  year: number;
  month: number;
  expensesByDay: Map<string, DayExpenses>;
  totalSpent: number;
  isLoading: boolean;
}

/**
 * 指定月のカレンダー用支出データを取得
 * 日付ごとに支出をグループ化して返す
 *
 * @param year 対象年
 * @param month 対象月（1-12）
 * @returns 日付ごとの支出データ
 */
export function useCalendarExpenses(
  year: number = new Date().getFullYear(),
  month: number = new Date().getMonth() + 1
): CalendarExpensesResult {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  // 支出をサーバーから取得（端末間同期用）
  const expensesQuery = trpc.getExpenses.useQuery(
    { month: monthStr },
    {
      retry: 1,
      staleTime: 30 * 1000,
      refetchOnWindowFocus: true,
    }
  );

  const serverDataUpdatedAt = expensesQuery.dataUpdatedAt;

  // 支出をIndexedDBからリアルタイム取得
  const expensesData = useLiveQuery(async () => {
    // サーバーからデータが取得されていればマージ
    if (expensesQuery.data?.expenses) {
      const serverExpenses: ExpenseEntity[] = expensesQuery.data.expenses.map((e) => ({
        id: e.id,
        amount: e.amount,
        category: e.category ?? undefined,
        memo: e.memo ?? undefined,
        date: e.date,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        deviceId: e.deviceId,
        syncStatus: 'synced' as const,
      }));
      await mergeExpensesFromServer(serverExpenses);
    }

    const expenses = await getExpensesByMonth(monthStr);

    // 日付ごとにグループ化
    const expensesByDay = new Map<string, DayExpenses>();
    let totalSpent = 0;

    for (const expense of expenses) {
      const date = expense.date;
      totalSpent += expense.amount;

      if (expensesByDay.has(date)) {
        const dayData = expensesByDay.get(date)!;
        dayData.expenses.push(expense);
        dayData.total += expense.amount;
      } else {
        expensesByDay.set(date, {
          date,
          expenses: [expense],
          total: expense.amount,
        });
      }
    }

    return { expensesByDay, totalSpent };
  }, [monthStr, serverDataUpdatedAt]);

  if (!expensesData) {
    return {
      year,
      month,
      expensesByDay: new Map(),
      totalSpent: 0,
      isLoading: true,
    };
  }

  return {
    year,
    month,
    expensesByDay: expensesData.expensesByDay,
    totalSpent: expensesData.totalSpent,
    isLoading: false,
  };
}
