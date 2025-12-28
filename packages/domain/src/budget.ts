// 予算・残額計算のドメインロジック

/**
 * 予算から支出合計を引いた残額を計算する
 */
export function calculateRemaining(
  budget: number,
  expenses: Array<{ amount: number }>
): number {
  const totalExpense = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  return budget - totalExpense;
}
