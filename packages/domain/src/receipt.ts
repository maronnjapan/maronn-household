/**
 * レシート（生成AIが写真から読み取った購入記録）を家計簿の支出に変換するドメインロジック
 *
 * レシートは「支払総額」を正とし、家計簿の支出（予算計算に使う金額）はカテゴリごとに按分して作る。
 * 明細の合計と支払総額の差（消費税・値引きなど）は明細金額の比率で按分し、
 * 支出の合計が必ず支払総額と一致するようにする。
 */
import { FALLBACK_CATEGORY } from './categories';

export const DEFAULT_RECEIPT_CATEGORY = FALLBACK_CATEGORY;

const MAX_MEMO_ITEM_NAMES = 3;

export interface ReceiptItemInput {
  name: string;
  /** 行の金額（数量×単価、円、0以上の整数）。値引きは明細に入れず totalAmount に反映する */
  amount: number;
  quantity?: number;
  category?: string;
}

export interface ReceiptInput {
  storeName: string;
  /** 購入日時（ISO 8601。'YYYY-MM-DD' または 'YYYY-MM-DDTHH:mm'） */
  purchasedAt: string;
  /** 支払総額（税込・値引き後、円、整数） */
  totalAmount: number;
  /** 明細にカテゴリがない場合に使うカテゴリ */
  category?: string;
  taxAmount?: number;
  paymentMethod?: string;
  items?: ReceiptItemInput[];
}

export interface ExpenseAllocation {
  category: string;
  amount: number;
  memo: string;
}

interface CategoryGroup {
  category: string;
  itemTotal: number;
  names: string[];
}

/**
 * レシートをカテゴリ別の支出に按分する
 */
export function allocateReceiptToExpenses(receipt: ReceiptInput): ExpenseAllocation[] {
  const fallbackCategory = receipt.category ?? DEFAULT_RECEIPT_CATEGORY;
  const items = receipt.items ?? [];

  if (items.length === 0) {
    return [{ category: fallbackCategory, amount: receipt.totalAmount, memo: receipt.storeName }];
  }

  const groups = groupItemsByCategory(items, fallbackCategory);
  const amounts = distributeTotal(
    receipt.totalAmount,
    groups.map((group) => group.itemTotal)
  );

  return groups
    .map((group, index) => ({
      category: group.category,
      amount: amounts[index] ?? 0,
      memo: buildMemo(receipt.storeName, group.names),
    }))
    .filter((allocation) => allocation.amount !== 0);
}

function groupItemsByCategory(items: ReceiptItemInput[], fallbackCategory: string): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>();
  for (const item of items) {
    const category = item.category ?? fallbackCategory;
    const group = groups.get(category) ?? { category, itemTotal: 0, names: [] };
    group.itemTotal += item.amount;
    group.names.push(item.name);
    groups.set(category, group);
  }
  return [...groups.values()];
}

/**
 * total を weights の比率で整数按分する（最大剰余法）
 * 合計は必ず total と一致する。weights の合計が0なら先頭に全額を割り当てる
 */
function distributeTotal(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum === 0) {
    return weights.map((_, index) => (index === 0 ? total : 0));
  }

  const exact = weights.map((weight) => (total * weight) / weightSum);
  const result = exact.map((value) => Math.floor(value));
  let remainder = total - result.reduce((sum, value) => sum + value, 0);

  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (const { index } of byFraction) {
    if (remainder <= 0) break;
    result[index] = (result[index] ?? 0) + 1;
    remainder--;
  }
  return result;
}

function buildMemo(storeName: string, names: string[]): string {
  const shown = names.slice(0, MAX_MEMO_ITEM_NAMES).join(', ');
  const rest = names.length - MAX_MEMO_ITEM_NAMES;
  return `${storeName}: ${shown}${rest > 0 ? ` ほか${rest}点` : ''}`;
}

/**
 * 購入日時から支出日（YYYY-MM-DD）を取り出す
 */
export function receiptDate(purchasedAt: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(purchasedAt.trim());
  const date = match?.[0].slice(0, 10);
  if (!match || !date) {
    throw new Error(`Invalid purchase date: ${purchasedAt}`);
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const calendar = new Date(Date.UTC(year, month - 1, day));
  const validDate =
    calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
  const validTime = match[4] === undefined || (Number(match[4]) < 24 && Number(match[5]) < 60);
  if (!validDate || !validTime) {
    throw new Error(`Invalid purchase date: ${purchasedAt}`);
  }
  return date;
}

export interface SpendingSummary {
  budget: number;
  spent: number;
  remaining: number;
  byCategory: { category: string; amount: number }[];
}

/**
 * 月の予算に対する支出状況とカテゴリ別内訳（金額の多い順）
 */
export function summarizeSpending(
  budget: number,
  expenses: { amount: number; category?: string | null }[]
): SpendingSummary {
  const byCategory = new Map<string, number>();
  for (const expense of expenses) {
    const category = expense.category || DEFAULT_RECEIPT_CATEGORY;
    byCategory.set(category, (byCategory.get(category) ?? 0) + expense.amount);
  }
  const spent = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  return {
    budget,
    spent,
    remaining: budget - spent,
    byCategory: [...byCategory.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
  };
}

/**
 * 月（YYYY-MM）の日付範囲。end は翌月1日で、範囲に含まない（date >= start AND date < end）
 */
export function monthDateRange(month: string): { start: string; end: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const year = Number(match?.[1]);
  const monthNum = Number(match?.[2]);
  if (!match || monthNum < 1 || monthNum > 12) {
    throw new Error(`Invalid month: ${month}`);
  }
  const nextYear = monthNum === 12 ? year + 1 : year;
  const nextMonth = monthNum === 12 ? 1 : monthNum + 1;
  return {
    start: `${month}-01`,
    end: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
  };
}

export interface ReceiptRecordingContext {
  userId: string;
  /** 記録したクライアント（MCP クライアントの client_id） */
  clientId: string;
  /** 記録日時（ISO 8601） */
  now: string;
  /** 行の ID を作る（ULID など） */
  newId: () => string;
}

/**
 * レシートの記録で保存する行（receipts / receipt_items / expenses）を組み立てる
 *
 * itemsTotal は明細の合計（明細がなければ null）、difference は支払総額との差（税・値引き・読み取り誤り）。
 * 差が大きいときは、読み取りを見直すきっかけとして呼び出し側に返す。
 */
export function planReceiptRecording(input: ReceiptInput, context: ReceiptRecordingContext) {
  const { userId, clientId, now, newId } = context;
  const receiptId = newId();
  const date = receiptDate(input.purchasedAt);
  const items = (input.items ?? []).map((item, position) => ({
    id: newId(),
    receiptId,
    position,
    name: item.name,
    amount: item.amount,
    quantity: item.quantity ?? null,
    category: item.category ?? null,
  }));
  const expenses = allocateReceiptToExpenses(input).map((allocation) => ({
    id: newId(),
    userId,
    amount: allocation.amount,
    category: allocation.category,
    memo: allocation.memo,
    date,
    createdAt: now,
    updatedAt: now,
    deviceId: `mcp:${clientId}`,
    receiptId,
  }));
  const itemsTotal = items.length > 0 ? items.reduce((sum, item) => sum + item.amount, 0) : null;
  return {
    receipt: {
      id: receiptId,
      userId,
      storeName: input.storeName,
      purchasedAt: input.purchasedAt,
      totalAmount: input.totalAmount,
      taxAmount: input.taxAmount ?? null,
      paymentMethod: input.paymentMethod ?? null,
      source: clientId,
      createdAt: now,
      updatedAt: now,
    },
    items,
    expenses,
    itemsTotal,
    difference: itemsTotal === null ? 0 : input.totalAmount - itemsTotal,
  };
}
