/**
 * 支出の最小インターフェース（金額のみ）
 */
export interface Expense {
  amount: number;
}

/**
 * 予算から支出合計を引いた残額を計算する
 * @param budget 月の予算
 * @param expenses 支出のリスト
 * @returns 残額（予算 - 支出合計）
 */
export function calculateRemaining(
  budget: number,
  expenses: readonly Expense[]
): number {
  const totalSpent = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  return budget - totalSpent;
}
