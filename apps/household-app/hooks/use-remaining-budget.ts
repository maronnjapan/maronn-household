import { useLiveQuery } from 'dexie-react-hooks';
import { calculateRemaining } from '@maronn/domain';
import { getExpensesByMonth, getCurrentMonth } from '../lib/db';
import { DEFAULT_BUDGET_AMOUNT } from '../lib/const';
import { trpc } from '../trpc/client';

export interface RemainingBudgetResult {
  budget: number;
  spent: number;
  remaining: number;
  month: string;
  isLoading: boolean;
  isBudgetLoading: boolean;
}

/**
 * 指定月の残額をリアルタイムで取得
 * 支出: IndexedDBの変更を自動で検知して再計算（< 50ms）
 * 予算: サーバーから取得（ネットワーク環境に依存、支出表示はブロックしない）
 *
 * @param month 対象月（YYYY-MM形式）。省略時は当月
 * @returns 予算、支出、残額の情報
 */
export function useRemainingBudget(
  month: string = getCurrentMonth()
): RemainingBudgetResult {
  // 予算をサーバーから取得（ネットワーク環境に依存）
  const budgetQuery = trpc.getBudget.useQuery({ month });

  // 支出をIndexedDBからリアルタイム取得（ローカルファースト）
  const expensesData = useLiveQuery(async () => {
    const expenses = await getExpensesByMonth(month);
    const spent = expenses.reduce((sum, e) => sum + e.amount, 0);

    return {
      expenses,
      spent,
    };
  }, [month]);

  // 予算額を決定（サーバーから取得できない場合はデフォルト値）
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
  };
}
