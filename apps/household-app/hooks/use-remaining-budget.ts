import { useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { calculateRemaining } from '@maronn/domain';
import type { ExpenseEntity } from '@maronn/domain';
import { getExpensesByMonth, getCurrentMonth, mergeExpensesFromServer } from '../lib/db';
import { DEFAULT_BUDGET_AMOUNT } from '../lib/const';
import { trpc } from '../trpc/client';

export interface RemainingBudgetResult {
  budget: number;
  spent: number;
  remaining: number;
  month: string;
  isLoading: boolean;
  isBudgetLoading: boolean;
  budgetError: Error | null;
}

/**
 * 指定月の残額をリアルタイムで取得
 * 支出: IndexedDBの変更を自動で検知して再計算（< 50ms）
 * 予算: サーバーから取得（ネットワーク環境に依存、支出表示はブロックしない）
 *
 * 初回ロード時にサーバーからデータを取得してIndexedDBと同期し、
 * 以降はIndexedDBのデータをリアルタイムで監視する（ローカルファースト）
 *
 * @param month 対象月（YYYY-MM形式）。省略時は当月
 * @returns 予算、支出、残額の情報
 */
export function useRemainingBudget(
  month: string = getCurrentMonth()
): RemainingBudgetResult {
  const lastMergedAtRef = useRef<number>(0);

  // 予算をサーバーから取得（ネットワーク環境に依存）
  const budgetQuery = trpc.getBudget.useQuery(
    { month },
    {
      retry: 1,
      staleTime: 30 * 1000, // 30秒
      refetchOnWindowFocus: true, // ウィンドウフォーカス時に再取得
    }
  );

  // 支出をサーバーから取得（端末間同期用）
  // staleTime: 0 で常に最新データを取得（他ページでの変更を即座に反映）
  const expensesQuery = trpc.getExpenses.useQuery(
    { month },
    {
      retry: 1,
      staleTime: 0,
      refetchOnWindowFocus: true,
    }
  );

  // サーバーからデータが取得されたらマージ（useLiveQueryの外で行う）
  // これにより useLiveQuery が純粋な読み取りクエリになり、IndexedDB変更を正しく検知できる
  const serverDataUpdatedAt = expensesQuery.dataUpdatedAt;
  if (expensesQuery.data?.expenses && serverDataUpdatedAt > lastMergedAtRef.current) {
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
    }));
    // 非同期でマージを実行（レンダリングをブロックしない）
    // 月を渡すことで、サーバーで削除されたデータもローカルから削除される
    mergeExpensesFromServer(serverExpenses, month).catch(console.error);
  }

  // 支出をIndexedDBからリアルタイム取得（読み取り専用）
  const expensesData = useLiveQuery(async () => {
    const expenses = await getExpensesByMonth(month);
    const spent = expenses.reduce((sum, e) => sum + e.amount, 0);

    return {
      expenses,
      spent,
    };
  }, [month]);

  // 予算額を決定（サーバーから取得できない場合やエラー時はデフォルト値）
  const budgetAmount = budgetQuery.data?.budget?.amount ?? DEFAULT_BUDGET_AMOUNT;

  // 支出データのローディング中
  if (!expensesData) {
    return {
      budget: budgetAmount,
      spent: 0,
      remaining: budgetAmount,
      month,
      isLoading: true,
      isBudgetLoading: budgetQuery.isLoading,
      budgetError: budgetQuery.error as Error | null,
    };
  }

  const remaining = calculateRemaining(budgetAmount, expensesData.expenses);

  return {
    budget: budgetAmount,
    spent: expensesData.spent,
    remaining,
    month,
    isLoading: false,
    isBudgetLoading: budgetQuery.isLoading,
    budgetError: budgetQuery.error as Error | null,
  };
}
