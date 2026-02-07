/**
 * サブ予算の月別金額設定
 */
export interface SubBudgetMonthlyAmount {
  month: string; // YYYY-MM
  amount: number;
}

/**
 * 次の月を取得（YYYY-MM形式）
 */
export function getNextMonth(month: string): string {
  const parts = month.split('-').map(Number);
  const year = parts[0]!;
  const monthNum = parts[1]!;

  if (monthNum === 12) {
    return `${year + 1}-01`;
  }
  return `${year}-${String(monthNum + 1).padStart(2, '0')}`;
}

/**
 * 月の範囲を生成（startMonth以上、endMonth未満）
 * @param startMonth 開始月（含む）
 * @param endMonth 終了月（含まない）
 * @returns 月の配列（YYYY-MM形式）
 */
export function getMonthRange(startMonth: string, endMonth: string): string[] {
  const months: string[] = [];
  let current = startMonth;
  while (current < endMonth) {
    months.push(current);
    current = getNextMonth(current);
  }
  return months;
}

/**
 * 指定月に有効なサブ予算の月額を取得
 * その月以前の最新の月別金額設定を使用、なければデフォルト値
 *
 * @param month 対象月（YYYY-MM形式）
 * @param monthlyAmounts 月別金額設定（月順にソート済み）
 * @param defaultAmount デフォルト金額
 * @returns 有効な月額
 */
export function getEffectiveMonthlyAmount(
  month: string,
  monthlyAmounts: readonly SubBudgetMonthlyAmount[],
  defaultAmount: number
): number {
  let effectiveAmount = defaultAmount;
  for (const ma of monthlyAmounts) {
    if (ma.month <= month) {
      effectiveAmount = ma.amount;
    } else {
      break;
    }
  }
  return effectiveAmount;
}

/**
 * サブ予算の繰り越し額を計算
 * startMonth から targetMonth の前月までの各月の (月額予算 - 支出) の累計
 *
 * @param startMonth 開始月（YYYY-MM形式）
 * @param targetMonth 対象月（YYYY-MM形式）
 * @param monthlyAmounts 月別金額設定（月順にソート済み）
 * @param defaultAmount デフォルト金額
 * @param expensesByMonth 月ごとの支出合計のMap
 * @returns 繰り越し額（正の値=余り繰り越し、負の値=超過繰り越し）
 */
export function calculateSubBudgetCarryover(
  startMonth: string,
  targetMonth: string,
  monthlyAmounts: readonly SubBudgetMonthlyAmount[],
  defaultAmount: number,
  expensesByMonth: ReadonlyMap<string, number>
): number {
  let carryover = 0;
  const months = getMonthRange(startMonth, targetMonth);

  for (const month of months) {
    const amount = getEffectiveMonthlyAmount(month, monthlyAmounts, defaultAmount);
    const spent = expensesByMonth.get(month) ?? 0;
    carryover += amount - spent;
  }

  return carryover;
}

/**
 * サブ予算の利用可能額を計算
 * 今月の月額予算 + 繰り越し額
 *
 * @param monthlyAmount 今月の月額予算
 * @param carryover 繰り越し額
 * @returns 利用可能額
 */
export function calculateSubBudgetAvailable(
  monthlyAmount: number,
  carryover: number
): number {
  return monthlyAmount + carryover;
}

/**
 * サブ予算の残額を計算
 * 利用可能額 - 今月の支出
 *
 * @param available 利用可能額
 * @param spent 今月の支出
 * @returns 残額
 */
export function calculateSubBudgetRemaining(
  available: number,
  spent: number
): number {
  return available - spent;
}
