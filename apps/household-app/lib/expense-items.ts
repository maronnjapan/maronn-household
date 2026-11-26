/**
 * 内訳（1回の会計で何を買ったか）の入力フォームの行と、保存する内訳の変換
 *
 * 支払総額は電卓（記録画面）や金額欄（カレンダー）で入力し、内訳はその下の行で入力する。
 * カテゴリー別の集計では支払総額を内訳の比率で按分するので、内訳の一部だけを入力したときは、
 * 足りない分を「残り」の1行（会計のカテゴリーに計上）として保存する。差が消費税・値引きなら比率での配分も選べる。
 */
import {
  MAX_EXPENSE_ITEMS,
  MAX_EXPENSE_ITEM_AMOUNT,
  MAX_EXPENSE_ITEM_NAME_LENGTH,
  itemsTotal,
  normalizeExpenseItems,
  type ExpenseItem,
} from '@maronn/domain/expense-items';
import { evaluateExpression } from '../utils/calculator';

/** 入力中の内訳の1行（金額は入力どおりの文字列） */
export interface ItemDraft {
  /** React の key（行の追加・削除で入力欄がずれないように） */
  key: string;
  name: string;
  amount: string;
  /** カテゴリーの value。空なら会計のカテゴリーに計上する */
  category: string;
  /** 保存済みの数量（MCP で記録したレシートの明細など）。フォームでは編集しない */
  quantity?: number;
  /** 保存済みのメモ（MCP で記録したレシートの明細など）。フォームでは編集せず、保存し直しても残す */
  memo?: string;
}

export type ParsedItems =
  | { ok: true; items: ExpenseItem[] | undefined }
  | { ok: false; error: string; invalidKeys: string[] };

let draftSequence = 0;

export function newItemDraft(): ItemDraft {
  draftSequence += 1;
  return { key: `item-${draftSequence}`, name: '', amount: '', category: '' };
}

/** 保存した内訳を編集用の行にする */
export function draftsFromItems(items: readonly ExpenseItem[] | null | undefined): ItemDraft[] {
  return (items ?? []).map((item) => ({
    ...newItemDraft(),
    name: item.name,
    amount: String(item.amount),
    category: item.category ?? '',
    ...(item.quantity !== undefined ? { quantity: item.quantity } : {}),
    ...(item.memo !== undefined ? { memo: item.memo } : {}),
  }));
}

/** 金額の欄を読む（全角数字・カンマ・電卓の式を受け付け、空なら0）。読めない・負・上限超えなら null */
function parseAmount(input: string): number | null {
  const normalized = input.normalize('NFKC').replace(/[,，\s]/g, '');
  if (!normalized) return 0;
  const amount = evaluateExpression(normalized);
  return amount !== null && amount >= 0 && amount <= MAX_EXPENSE_ITEM_AMOUNT ? amount : null;
}

function isBlank(draft: ItemDraft): boolean {
  return !draft.name.trim() && !draft.amount.trim();
}

/**
 * 入力した行を保存する内訳にする
 * 品名も金額もない行は無視し、品名だけの行は金額0にする。金額が読めない行や、品名が長すぎる行があればエラー
 */
export function parseItemDrafts(drafts: readonly ItemDraft[]): ParsedItems {
  const filled = drafts.filter((draft) => !isBlank(draft));
  if (filled.length > MAX_EXPENSE_ITEMS) {
    return { ok: false, error: `内訳は${MAX_EXPENSE_ITEMS}行までです`, invalidKeys: [] };
  }

  const badAmount = filled.filter((draft) => parseAmount(draft.amount) === null);
  if (badAmount.length > 0) {
    return {
      ok: false,
      error: `内訳の金額を0〜${MAX_EXPENSE_ITEM_AMOUNT.toLocaleString('ja-JP')}の数で入力してください`,
      invalidKeys: badAmount.map((draft) => draft.key),
    };
  }
  const longName = filled.filter((draft) => draft.name.trim().length > MAX_EXPENSE_ITEM_NAME_LENGTH);
  if (longName.length > 0) {
    return {
      ok: false,
      error: `内訳の品名は${MAX_EXPENSE_ITEM_NAME_LENGTH}文字以内で入力してください`,
      invalidKeys: longName.map((draft) => draft.key),
    };
  }

  return {
    ok: true,
    items: normalizeExpenseItems(
      filled.map((draft) => ({
        name: draft.name,
        amount: parseAmount(draft.amount) ?? 0,
        quantity: draft.quantity,
        category: draft.category,
        memo: draft.memo,
      }))
    ),
  };
}

/** 読める行の金額の合計と、支払総額との差（支払総額 − 内訳の合計。支払総額が未入力なら null） */
export function summarizeItemDrafts(
  drafts: readonly ItemDraft[],
  total: number | null
): { itemsTotal: number; difference: number | null } {
  const itemsTotal = drafts.reduce((sum, draft) => sum + (parseAmount(draft.amount) ?? 0), 0);
  return { itemsTotal, difference: total === null ? null : total - itemsTotal };
}

/**
 * 保存する内訳を作る
 * 支払総額より内訳の合計が少なければ、足りない分を「残り」の1行（品名なし・カテゴリーなし＝会計のカテゴリーに計上）にする。
 * 品名がなくカテゴリーが空か会計のカテゴリーの行がすでにあれば（前に保存した残り。保存時にカテゴリーが入る）その行に足す。
 * spreadDifference なら残りの行は作らず、差は消費税・値引きとしてカテゴリー別の集計で内訳の比率で配る。
 * 内訳の合計が支払総額以上（値引き）や、品名だけの内訳（金額がすべて0）のときも残りの行は作らない
 */
export function finalizeItemDrafts(
  drafts: readonly ItemDraft[],
  total: number | null,
  { spreadDifference, expenseCategory = '' }: { spreadDifference: boolean; expenseCategory?: string }
): ParsedItems {
  const parsed = parseItemDrafts(drafts);
  if (!parsed.ok || !parsed.items || spreadDifference || total === null) return parsed;

  const items = parsed.items;
  const sum = itemsTotal(items);
  const hasRoomForRow = items.length < MAX_EXPENSE_ITEMS;
  const difference = total - sum;
  if (sum === 0 || difference <= 0) return parsed;

  const remainderIndex = items.findIndex(
    (item) => !item.name && (!item.category || (expenseCategory !== '' && item.category === expenseCategory))
  );
  const remainder = remainderIndex >= 0 ? (items[remainderIndex]?.amount ?? 0) + difference : difference;
  // 行を足せない（上限の行数・金額を超える）ときは、差を比率で配分する
  if (remainder > MAX_EXPENSE_ITEM_AMOUNT || (remainderIndex < 0 && !hasRoomForRow)) return parsed;
  return {
    ok: true,
    items:
      remainderIndex >= 0
        ? items.map((item, index) => (index === remainderIndex ? { ...item, amount: remainder } : item))
        : [...items, { name: '', amount: remainder }],
  };
}

/**
 * 保存済みの支出を編集するときの「差額は消費税・値引き」の既定
 * 内訳の合計が支払総額より少ない記録（レシートの消費税など、差を比率で配分している）は、そのまま比率での配分にする。
 * 残りの行を作る既定にすると、メモを直しただけで差が「残り」の行に変わってしまうため
 */
export function initialSpreadDifference(items: readonly ExpenseItem[] | null | undefined, amount: number): boolean {
  const total = itemsTotal(items);
  return total > 0 && total < amount;
}

/**
 * 行を書き換える。品名か金額を書き換えた行は保存済みの数量を外す
 * （数量はフォームに出さないので、MCP の読み取りの誤りを直したときに古い「×2」が黙って残らないように）
 */
export function updateItemDraft(draft: ItemDraft, patch: Partial<Omit<ItemDraft, 'key'>>): ItemDraft {
  const updated = { ...draft, ...patch };
  if (patch.name === undefined && patch.amount === undefined) return updated;
  const { quantity: _quantity, ...withoutQuantity } = updated;
  return withoutQuantity;
}
