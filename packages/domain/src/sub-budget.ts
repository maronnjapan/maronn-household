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
 * 2つのYYYY-MM間の月数を計算
 * @param from 開始月（含む）
 * @param to 終了月（含まない）
 * @returns 月数（toがfromより前の場合は0）
 */
export function monthsBetween(from: string, to: string): number {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  const diff = (y2! - y1!) * 12 + (m2! - m1!);
  return Math.max(0, diff);
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
 * 期間内の予算合計を計算（月ループなし）
 * 予算変更の区間ごとに「レート × 月数」で合算する
 *
 * @param startMonth 開始月（含む、YYYY-MM形式）
 * @param endMonth 終了月（含まない、YYYY-MM形式）
 * @param monthlyAmounts 月別金額設定（月順にソート済み）
 * @param defaultAmount デフォルト金額
 * @returns 期間内の予算合計
 */
export function calculateTotalAllocated(
  startMonth: string,
  endMonth: string,
  monthlyAmounts: readonly SubBudgetMonthlyAmount[],
  defaultAmount: number
): number {
  if (startMonth >= endMonth) return 0;

  // startMonth時点での有効レートを決定
  let currentRate = defaultAmount;
  const rateChanges: { month: string; amount: number }[] = [];

  for (const ma of monthlyAmounts) {
    if (ma.month <= startMonth) {
      currentRate = ma.amount;
    } else if (ma.month < endMonth) {
      rateChanges.push(ma);
    }
  }

  // 各区間の「レート × 月数」を合算
  let total = 0;
  let periodStart = startMonth;

  for (const change of rateChanges) {
    total += currentRate * monthsBetween(periodStart, change.month);
    currentRate = change.amount;
    periodStart = change.month;
  }

  // 最後の区間
  total += currentRate * monthsBetween(periodStart, endMonth);

  return total;
}

/**
 * サブ予算の繰り越し額を計算
 * 繰り越し = 過去の予算合計 - 過去の支出合計
 *
 * @param totalAllocated 過去月の予算合計
 * @param totalPastExpenses 過去月の支出合計
 * @returns 繰り越し額（正=余り、負=超過）
 */
export function calculateSubBudgetCarryover(
  totalAllocated: number,
  totalPastExpenses: number
): number {
  return totalAllocated - totalPastExpenses;
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
