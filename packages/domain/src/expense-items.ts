/**
 * 支出（1回の会計）の内訳
 *
 * 支出の amount は支払総額（カード明細などと一致する、会計の合計）。内訳は「何を買ったか」（品名・金額・カテゴリー）を残す。
 * 予算の計算は支払総額で行い、カテゴリー別の集計だけは支払総額を内訳の金額の比率で按分して作る。
 * 内訳の合計と支払総額の差（消費税・値引き・一部だけの入力）も比率で配り、按分の合計は必ず支払総額と一致させる。
 */
import { FALLBACK_CATEGORY } from './categories';

/** 1件の支出に持てる内訳の行数 */
export const MAX_EXPENSE_ITEMS = 200;
export const MAX_EXPENSE_ITEM_NAME_LENGTH = 100;
/** 内訳の1行の金額の上限（円） */
export const MAX_EXPENSE_ITEM_AMOUNT = 100_000_000;
export const MAX_EXPENSE_ITEM_QUANTITY = 10_000;
/** 内訳のカテゴリー（value）の長さの上限（追加したカテゴリーの value は ULID の 26 文字） */
export const MAX_EXPENSE_ITEM_CATEGORY_LENGTH = 40;

export interface ExpenseItem {
  /** 品名（空でもよい。そのときはカテゴリー名で表示する） */
  name: string;
  /** 行の金額（数量×単価、円、0以上の整数） */
  amount: number;
  quantity?: number;
  /** カテゴリーの value。なければ支出（会計）のカテゴリーに計上する */
  category?: string;
}

export interface CategoryAmount {
  category: string;
  amount: number;
}

/** カテゴリー別の按分に使う支出の形（サーバーの行は category・items が null になる） */
export interface AllocatableExpense {
  amount: number;
  category?: string | null;
  items?: readonly ExpenseItem[] | null;
}

/**
 * 支出をカテゴリー別の金額に分ける
 * 内訳がなければ支払総額を会計のカテゴリー（なければ other）に計上する。内訳の金額がすべて0（品名だけの内訳）でも同じ。
 * 内訳があれば、内訳のカテゴリー（なければ会計のカテゴリー → other）ごとにまとめ、支払総額を内訳の金額の比率で按分する。
 * 並びは内訳に最初に現れた順。按分で0円になったカテゴリーは含めない
 */
export function allocateExpenseByCategory(expense: AllocatableExpense): CategoryAmount[] {
  const expenseCategory = expense.category || FALLBACK_CATEGORY;
  const items = expense.items ?? [];
  if (itemsTotal(items) === 0) {
    return [{ category: expenseCategory, amount: expense.amount }];
  }

  const weights = new Map<string, number>();
  for (const item of items) {
    const category = item.category || expenseCategory;
    weights.set(category, (weights.get(category) ?? 0) + item.amount);
  }
  const categories = [...weights.keys()];
  const amounts = distributeTotal(expense.amount, [...weights.values()]);
  return categories
    .map((category, index) => ({ category, amount: amounts[index] ?? 0 }))
    .filter((allocation) => allocation.amount !== 0);
}

/**
 * total を weights の比率で整数按分する（最大剰余法）
 * 合計は必ず total と一致する。weights の合計が0なら先頭に全額を割り当てる。
 * 大きな額でも誤差が出ないよう BigInt で計算する（total・weights は整数に丸める）
 */
export function distributeTotal(total: number, weights: number[]): number[] {
  const roundedTotal = BigInt(Math.round(total));
  const sign = roundedTotal < 0n ? -1n : 1n;
  const absTotal = roundedTotal * sign;
  const bigWeights = weights.map((weight) => BigInt(Math.max(0, Math.round(weight))));
  const weightSum = bigWeights.reduce((sum, weight) => sum + weight, 0n);
  if (weightSum === 0n) {
    return weights.map((_, index) => (index === 0 ? Number(roundedTotal) : 0));
  }

  const shares = bigWeights.map((weight) => ({
    quotient: (absTotal * weight) / weightSum,
    remainder: (absTotal * weight) % weightSum,
  }));
  let left = absTotal - shares.reduce((sum, share) => sum + share.quotient, 0n);
  const byRemainder = shares
    .map((share, index) => ({ index, remainder: share.remainder }))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  const result = shares.map((share) => share.quotient);
  for (const { index } of byRemainder) {
    if (left <= 0n) break;
    result[index] = (result[index] ?? 0n) + 1n;
    left -= 1n;
  }
  return result.map((value) => Number(value * sign));
}

/** 内訳の金額の合計（内訳がなければ0） */
export function itemsTotal(items: readonly { amount: number }[] | null | undefined): number {
  return (items ?? []).reduce((sum, item) => sum + item.amount, 0);
}

/**
 * 保存する形にそろえる（品名の前後の空白を除き、指定のない任意の項目は持たない）。内訳がなければ undefined
 */
export function normalizeExpenseItems(
  items: readonly ExpenseItemInput[] | null | undefined
): ExpenseItem[] | undefined {
  if (!items || items.length === 0) return undefined;
  return items.map(({ name, amount, quantity, category }) => ({
    name: name.replace(/\s+/g, ' ').trim(),
    amount,
    ...(quantity !== undefined && quantity !== null ? { quantity } : {}),
    ...(category ? { category } : {}),
  }));
}

/** 入力（サーバーの行やフォーム）での内訳の形。任意の項目は null も受け付ける */
export interface ExpenseItemInput {
  name: string;
  amount: number;
  quantity?: number | null;
  category?: string | null;
}

/**
 * 内訳を1行の文字列にする（例: 「牛乳 ¥198 / 洗剤 ×2 ¥1,398」）。CSV の列に使うので改行は含めない
 * 品名がなければカテゴリー名（内訳のカテゴリー → 会計のカテゴリー。labelOf で分からなければ「内訳」）で表す。金額が0なら品名だけ
 */
export function formatItemsText(
  items: readonly ExpenseItem[] | null | undefined,
  labelOf: (value: string) => string | undefined = () => undefined,
  expenseCategory?: string
): string {
  return (items ?? [])
    .map((item) => {
      const category = item.category || expenseCategory;
      const name = item.name.replace(/\s+/g, ' ').trim() || (category && labelOf(category)) || '内訳';
      const quantity = item.quantity !== undefined ? ` ×${item.quantity}` : '';
      const amount = item.amount !== 0 ? ` ¥${item.amount.toLocaleString('ja-JP')}` : '';
      return `${name}${quantity}${amount}`;
    })
    .join(' / ');
}

/**
 * 保存する会計のカテゴリーと内訳のカテゴリーを確定する
 * - カテゴリーのない内訳には会計のカテゴリー（なければ other）を入れる。後から会計のカテゴリーを変えても按分が動かないように。
 *   ただし内訳に入れられない長さ（MAX_EXPENSE_ITEM_CATEGORY_LENGTH 超え。CSV から取り込んだ値など）は写さない（会計のカテゴリーに計上される）
 * - 会計のカテゴリーがなく内訳があれば、按分額が最大のカテゴリー（主なカテゴリー）を会計のカテゴリーにする。
 *   カレンダー・CSV・エクスポート API・Webhook の category は会計のカテゴリーを1つだけ出すため。
 *   品名だけの内訳（金額がすべて0）なら、最初にカテゴリーのある内訳のカテゴリーにする（全額がそこに計上される）
 */
export function resolveExpenseCategories<Items extends readonly ExpenseItem[] | null | undefined>(expense: {
  amount: number;
  category?: string | null;
  items?: Items;
}): { category: string | undefined; items: Items | ExpenseItem[] } {
  const items = expense.items;
  if (!items || items.length === 0) {
    return { category: expense.category || undefined, items: items as Items };
  }
  const fallback = expense.category || FALLBACK_CATEGORY;
  const fill = fallback.length <= MAX_EXPENSE_ITEM_CATEGORY_LENGTH ? fallback : undefined;
  const resolvedItems = items.map((item) => {
    const category = item.category || fill;
    return category ? { ...item, category } : item;
  });
  if (expense.category) {
    return { category: expense.category, items: resolvedItems };
  }
  if (itemsTotal(items) === 0) {
    return { category: items.find((item) => item.category)?.category ?? FALLBACK_CATEGORY, items: resolvedItems };
  }
  const allocation = allocateExpenseByCategory({ amount: expense.amount, items: resolvedItems });
  const main = allocation.reduce<CategoryAmount | undefined>(
    (best, current) => (best === undefined || current.amount > best.amount ? current : best),
    undefined
  );
  return { category: main?.category ?? FALLBACK_CATEGORY, items: resolvedItems };
}
