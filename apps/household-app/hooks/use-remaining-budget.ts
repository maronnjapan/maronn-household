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
  const expensesQuery = trpc.getExpenses.useQuery(
    { month },
    {
      retry: 1,
      staleTime: 30 * 1000, // 30秒（別端末からのデータを反映するため短く設定）
      refetchOnWindowFocus: true, // ウィンドウフォーカス時に再取得
    }
  );

  // サーバーからのデータ取得状態（依存配列用）
  const serverDataUpdatedAt = expensesQuery.dataUpdatedAt;

  // 支出をIndexedDBからリアルタイム取得（ローカルファースト）
  // サーバーからのデータ取得完了時にも再実行してマージを行う
  const expensesData = useLiveQuery(async () => {
    // サーバーからデータが取得されていればマージ（毎回マージして最新状態を保つ）
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
      // マージ完了を待ってからIndexedDBを読み込む
      await mergeExpensesFromServer(serverExpenses);
    }

    const expenses = await getExpensesByMonth(month);
    const spent = expenses.reduce((sum, e) => sum + e.amount, 0);

    return {
      expenses,
      spent,
    };
  }, [month, serverDataUpdatedAt]);

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
