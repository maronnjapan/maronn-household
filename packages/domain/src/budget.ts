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

/**
 * 指定月の総日数を取得する
 * @param month 対象月（YYYY-MM形式）
 * @returns 月の総日数
 */
export function getTotalDaysInMonth(month: string): number {
  const [year, monthNum] = month.split('-').map(Number);

  // 月の値が不正な場合は0を返す
  if (year === undefined || monthNum === undefined) {
    return 0;
  }

  return new Date(year, monthNum, 0).getDate();
}

/**
 * 今日の支出合計を計算する
 * @param expenses 支出のリスト
 * @param month 対象月（YYYY-MM形式）
 * @param currentDate 現在日時（テスト用、省略時は現在日時）
 * @returns 今日の支出合計
 */
export function calculateTodaySpent(
  expenses: readonly Expense[],
  month: string,
  currentDate: Date = new Date()
): number {
  const [year, monthNum] = month.split('-').map(Number);

  // 月が異なる場合は0を返す
  if (currentDate.getFullYear() !== year || currentDate.getMonth() + 1 !== monthNum) {
    return 0;
  }

  const today = currentDate.getDate();
  const todayString = `${year}-${String(monthNum).padStart(2, '0')}-${String(today).padStart(2, '0')}`;

  // 今日の日付に一致する支出の合計
  return expenses
    .filter(expense => 'date' in expense && expense.date === todayString)
    .reduce((sum, expense) => sum + expense.amount, 0);
}

/**
 * 予算から計算した一日の利用可能額を計算する
 * @param budget 月の予算
 * @param month 対象月（YYYY-MM形式）
 * @returns 一日の利用可能額（予算 / 月の日数）
 */
export function calculateBudgetBasedDailyAllowance(
  budget: number,
  month: string
): number {
  const totalDays = getTotalDaysInMonth(month);

  if (totalDays === 0) {
    return 0;
  }

  return budget / totalDays;
}

/**
 * 今日の残り利用可能額を計算する
 * @param budget 月の予算
 * @param expenses 支出のリスト
 * @param month 対象月（YYYY-MM形式）
 * @param currentDate 現在日時（テスト用、省略時は現在日時）
 * @returns 今日の残り利用可能額（一日の利用可能額 - 今日の利用額）
 */
export function calculateTodayRemaining(
  budget: number,
  expenses: readonly Expense[],
  month: string,
  currentDate: Date = new Date()
): number {
  const dailyAllowance = calculateBudgetBasedDailyAllowance(budget, month);
  const todaySpent = calculateTodaySpent(expenses, month, currentDate);

  return dailyAllowance - todaySpent;
}

/**
 * 予算ペース対比を計算する（予定ペース - 実際の支出）
 * @param budget 月の予算
 * @param expenses 支出のリスト
 * @param month 対象月（YYYY-MM形式）
 * @param currentDate 現在日時（テスト用、省略時は現在日時）
 * @returns 予算ペース対比（正の値なら予算内で順調、負の値なら使いすぎ）
 */
export function calculateBudgetPaceComparison(
  budget: number,
  expenses: readonly Expense[],
  month: string,
  currentDate: Date = new Date()
): number {
  const [year, monthNum] = month.split('-').map(Number);

  // 月が異なる場合は0を返す
  if (currentDate.getFullYear() !== year || currentDate.getMonth() + 1 !== monthNum) {
    return 0;
  }

  const dailyAllowance = calculateBudgetBasedDailyAllowance(budget, month);
  const elapsedDays = currentDate.getDate();
  const expectedSpent = dailyAllowance * elapsedDays;
  const actualSpent = expenses.reduce((sum, expense) => sum + expense.amount, 0);

  return expectedSpent - actualSpent;
}

/**
 * 前月の月（YYYY-MM形式）を取得する
 * @param currentDate 現在日時（テスト用、省略時は現在日時）
 * @returns 前月（YYYY-MM形式）
 */
export function getPreviousMonth(currentDate: Date = new Date()): string {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth(); // 0-indexed

  if (month === 0) {
    // 1月の場合は前年の12月
    return `${year - 1}-12`;
  }

  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * 今日が月初日（1日）かどうかを判定する
 * @param currentDate 現在日時（テスト用、省略時は現在日時）
 * @returns 月初日ならtrue
 */
export function isFirstDayOfMonth(currentDate: Date = new Date()): boolean {
  return currentDate.getDate() === 1;
}

/**
 * 予算内に収まったかどうかを判定する
 * @param budget 月の予算
 * @param expenses 支出のリスト
 * @returns 予算内ならtrue（残額が0以上）
 */
export function isWithinBudget(
  budget: number,
  expenses: readonly Expense[]
): boolean {
  const remaining = calculateRemaining(budget, expenses);
  return remaining >= 0;
}

/**
 * 月初祝福を表示すべきかどうかを判定する
 * 条件:
 * - 今日が月初日（1日）である
 * - 前月の支出が予算内に収まっている
 *
 * @param previousMonthBudget 前月の予算
 * @param previousMonthExpenses 前月の支出リスト
 * @param currentDate 現在日時（テスト用、省略時は現在日時）
 * @returns 祝福を表示すべきならtrue
 */
export function shouldShowCelebration(
  previousMonthBudget: number,
  previousMonthExpenses: readonly Expense[],
  currentDate: Date = new Date()
): boolean {
  // 月初日でなければ表示しない
  if (!isFirstDayOfMonth(currentDate)) {
    return false;
  }

  // 前月が予算内でなければ表示しない
  return isWithinBudget(previousMonthBudget, previousMonthExpenses);
}
