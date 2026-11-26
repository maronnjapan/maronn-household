/**
 * 支出（1回の会計）の店名。メモとは別の任意の項目
 * （receipt.ts からも使うので、ブラウザの API に触れる expense.ts とは分けておく）
 */
import { toSingleLine } from './expense-items';

/** 店名の長さの上限 */
export const MAX_STORE_NAME_LENGTH = 100;

/**
 * 保存する店名にそろえる（1行にし、上限を超える分は切る。空なら null = 店名なし）
 * 長すぎる値を拒否すると、端末に保存された支出がサーバーに受け付けられず、同期待ちのまま残り続けるので切る。
 * 文字数はコードポイントで数える（サロゲートペアの途中では切らない）。切った後の末尾の空白も除き、何度そろえても同じ値にする
 */
export function normalizeStoreName(storeName: string | null | undefined): string | null {
  const singleLine = storeName ? toSingleLine(storeName) : '';
  return Array.from(singleLine).slice(0, MAX_STORE_NAME_LENGTH).join('').trimEnd() || null;
}
