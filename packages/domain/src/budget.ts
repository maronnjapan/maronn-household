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

/**
 * 指定月の残り日数を計算する
 * @param month 対象月（YYYY-MM形式）
 * @param currentDate 現在日時（テスト用、省略時は現在日時）
 * @returns 残り日数（当日を含む）
 */
export function calculateRemainingDays(
  month: string,
  currentDate: Date = new Date()
): number {
  const [year, monthNum] = month.split('-').map(Number);

  // 月の値が不正な場合は0を返す
  if (year === undefined || monthNum === undefined) {
    return 0;
  }
  const lastDay = new Date(year, monthNum, 0).getDate(); // 月末日
  const today = currentDate.getDate();

  // 月が異なる場合は0を返す
  if (currentDate.getFullYear() !== year || currentDate.getMonth() + 1 !== monthNum) {
    return 0;
  }

  return lastDay - today + 1; // 当日を含むため +1
}

/**
 * 一日あたりの平均使用額を計算する
 * @param spent 総支出額
 * @param month 対象月（YYYY-MM形式）
 * @param currentDate 現在日時（テスト用、省略時は現在日時）
 * @returns 一日あたりの平均使用額
 */
export function calculateDailyAverage(
  spent: number,
  month: string,
  currentDate: Date = new Date()
): number {
  const [year, monthNum] = month.split('-').map(Number);

  // 月が異なる場合は0を返す
  if (currentDate.getFullYear() !== year || currentDate.getMonth() + 1 !== monthNum) {
    return 0;
  }

  const today = currentDate.getDate();

  // 1日目の場合は0除算を避けるため、支出額をそのまま返す
  if (today === 1) {
    return spent;
  }

  return spent / today;
}

/**
 * 残り日数から一日あたりの使用可能額を計算する
 * @param remaining 残額
 * @param month 対象月（YYYY-MM形式）
 * @param currentDate 現在日時（テスト用、省略時は現在日時）
 * @returns 一日あたりの使用可能額（残り日数が0の場合は0）
 */
export function calculateDailyLimit(
  remaining: number,
  month: string,
  currentDate: Date = new Date()
): number {
  const remainingDays = calculateRemainingDays(month, currentDate);

  if (remainingDays === 0) {
    return 0;
  }

  return remaining / remainingDays;
}
