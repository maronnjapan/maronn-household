import { useLiveQuery } from 'dexie-react-hooks';
import { calculateRemaining } from '@maronn/domain';
import { getBudget, getExpensesByMonth, getCurrentMonth } from '../lib/db';
import { DEFAULT_BUDGET_AMOUNT } from '../lib/const';

export interface RemainingBudgetResult {
  budget: number;
  spent: number;
  remaining: number;
  month: string;
  isLoading: boolean;
}

/**
 * 指定月の残額をリアルタイムで取得
 * IndexedDBの変更を自動で検知して再計算（< 50ms）
 *
 * @param month 対象月（YYYY-MM形式）。省略時は当月
 * @returns 予算、支出、残額の情報
 */
export function useRemainingBudget(
  month: string = getCurrentMonth()
): RemainingBudgetResult {
  // useLiveQuery でリアクティブに取得
  // IndexedDB が更新されると自動で再実行される
  const data = useLiveQuery(async () => {
    const [budget, expenses] = await Promise.all([
      getBudget(month, DEFAULT_BUDGET_AMOUNT),
      getExpensesByMonth(month),
    ]);

    const spent = expenses.reduce((sum, e) => sum + e.amount, 0);
    const remaining = calculateRemaining(budget.amount, expenses);

    return {
      budget: budget.amount,
      spent,
      remaining,
      month,
    };
  }, [month]);

  // ローディング中はデフォルト値を返す
  if (!data) {
    return {
      budget: 0,
      spent: 0,
      remaining: 0,
      month,
      isLoading: true,
    };
  }

  return {
    ...data,
    isLoading: false,
  };
}
