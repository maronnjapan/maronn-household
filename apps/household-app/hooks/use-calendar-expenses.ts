import { useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ExpenseEntity } from '@maronn/domain';
import { getExpensesByMonth, mergeExpensesFromServer } from '../lib/db';
import { trpc } from '../trpc/client';
import { useAuth } from './use-auth';

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
  /** 当月の全支出データ（エクスポート用） */
  allExpenses: ExpenseEntity[];
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
  const lastMergedAtRef = useRef<number>(0);
  const { isAuthenticated, userId } = useAuth();

  // 支出をサーバーから取得（認証時のみ、端末間同期用）
  // staleTime: 0 で常に最新データを取得（他ページでの変更を即座に反映）
  const expensesQuery = trpc.getExpenses.useQuery(
    { month: monthStr },
    {
      enabled: isAuthenticated, // 認証時のみ実行
      retry: 1,
      staleTime: 0,
      refetchOnWindowFocus: true,
    }
  );

  // サーバーからデータが取得されたらマージ（useLiveQueryの外で行う）
  // これにより useLiveQuery が純粋な読み取りクエリになり、IndexedDB変更を正しく検知できる
  const serverDataUpdatedAt = expensesQuery.dataUpdatedAt;
  if (isAuthenticated && expensesQuery.data?.expenses && serverDataUpdatedAt > lastMergedAtRef.current) {
    lastMergedAtRef.current = serverDataUpdatedAt;
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
      subBudgetId: e.subBudgetId ?? undefined,
    }));
    // 非同期でマージを実行（レンダリングをブロックしない）
    // 月とuserIdを渡すことで、サーバーで削除されたデータもローカルから削除される
    mergeExpensesFromServer(serverExpenses, monthStr, userId).catch(console.error);
  }

  // 支出をIndexedDBからリアルタイム取得（ユーザーIDでフィルタリング）
  const expensesData = useLiveQuery(async () => {
    const expenses = await getExpensesByMonth(monthStr, userId);

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

    return { expensesByDay, totalSpent, allExpenses: expenses };
  }, [monthStr, userId]);

  if (!expensesData) {
    return {
      year,
      month,
      expensesByDay: new Map(),
      totalSpent: 0,
      isLoading: true,
      allExpenses: [],
    };
  }

  return {
    year,
    month,
    expensesByDay: expensesData.expensesByDay,
    totalSpent: expensesData.totalSpent,
    isLoading: false,
    allExpenses: expensesData.allExpenses,
  };
}
