/**
 * レシート（生成AIが写真から読み取った購入記録）を家計簿の支出に変換するドメインロジック
 *
 * レシート1枚 = 1回の会計 = 支出1件。支出の金額は「支払総額」（カード明細などと一致する額）にし、
 * 明細は支出の内訳（何を買ったか）として持たせる。カテゴリー別の集計は、支払総額を内訳の金額の比率で按分して作る
 * （明細の合計と支払総額の差＝消費税・値引きも比率で配る。expense-items.ts の allocateExpenseByCategory）。
 */
import {
  allocateExpenseByCategory,
  itemsTotal,
  normalizeExpenseItems,
  resolveExpenseCategories,
  type AllocatableExpense,
  type CategoryAmount,
} from './expense-items';

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
  /** 会計のカテゴリー（明細にカテゴリーがない場合に使う） */
  category?: string;
  taxAmount?: number;
  paymentMethod?: string;
  items?: ReceiptItemInput[];
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
  byCategory: CategoryAmount[];
}

/**
 * 月の予算に対する支出状況とカテゴリ別内訳（金額の多い順）
 * 支出合計は支払総額の合計。内訳のある支出は、カテゴリ別内訳では内訳の比率で按分する
 */
export function summarizeSpending(budget: number, expenses: AllocatableExpense[]): SpendingSummary {
  const byCategory = new Map<string, number>();
  for (const expense of expenses) {
    for (const { category, amount } of allocateExpenseByCategory(expense)) {
      byCategory.set(category, (byCategory.get(category) ?? 0) + amount);
    }
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
 * レシートの記録で保存する行（receipts と、支払総額の支出1件とその内訳）を組み立てる
 *
 * byCategory はカテゴリー別の按分（記録の結果として呼び出し側に返す）。
 * itemsTotal は明細の合計（明細がなければ null）、difference は支払総額との差（税・値引き・読み取り誤り）。
 * 差が大きいときは、読み取りを見直すきっかけとして呼び出し側に返す。
 */
export function planReceiptRecording(input: ReceiptInput, context: ReceiptRecordingContext) {
  const { userId, clientId, now, newId } = context;
  const receiptId = newId();
  const date = receiptDate(input.purchasedAt);
  // 会計のカテゴリーがなければ主なカテゴリーにし、カテゴリーのない明細には会計のカテゴリーを入れる
  const { category, items } = resolveExpenseCategories({
    amount: input.totalAmount,
    category: input.category,
    items: normalizeExpenseItems(input.items) ?? null,
  });
  const expense = {
    id: newId(),
    userId,
    amount: input.totalAmount,
    category: category ?? null,
    memo: input.storeName,
    date,
    createdAt: now,
    updatedAt: now,
    deviceId: `mcp:${clientId}`,
    receiptId,
    items,
  };
  const total = items === null ? null : itemsTotal(items);
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
    expense,
    byCategory: allocateExpenseByCategory(expense),
    itemsTotal: total,
    difference: total === null ? 0 : input.totalAmount - total,
  };
}
