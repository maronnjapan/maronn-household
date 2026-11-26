import { useId } from 'react';
import { FALLBACK_CATEGORY } from '@maronn/domain/categories';
import { MAX_EXPENSE_ITEM_MEMO_LENGTH } from '@maronn/domain/expense-items';
import { useCategories } from '../hooks/use-categories';
import { categoryChoices } from '../lib/categories';
import {
  newItemDraft,
  parseItemDrafts,
  summarizeItemDrafts,
  updateItemDraft,
  type ItemDraft,
} from '../lib/expense-items';

interface ExpenseItemsEditorProps {
  drafts: ItemDraft[];
  onChange: (drafts: ItemDraft[]) => void;
  /** 支払総額（会計の合計。未入力なら null） */
  total: number | null;
  /** 会計のカテゴリー（未選択なら空文字）。カテゴリーを選ばない内訳と「残り」はここに計上する */
  expenseCategory: string;
  /** 支払総額との差を消費税・値引きとして内訳の比率で配分する（false なら「残り」の1行として保存する） */
  spreadDifference: boolean;
  onSpreadDifferenceChange: (spread: boolean) => void;
  /** 内訳の合計を支払総額にする（渡されたときだけボタンを出す） */
  onUseItemsTotal?: (itemsTotal: number) => void;
}

function formatYen(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`;
}

/**
 * 内訳（1回の会計で何を買ったか）の入力欄
 *
 * 行ごとに品名・金額・カテゴリーを入力する（品名だけ、金額とカテゴリーだけでもよい）。支払総額（電卓・金額欄）とは別に持つ。
 * 行ごとに任意のメモも書ける（MCP で記録した明細のメモもここで直せる）。
 * 内訳の合計が支払総額より少なければ、保存時に足りない分を「残り」の1行（会計のカテゴリー）にする。
 * 差が消費税・値引きなら、チェックを入れて内訳の比率で配分できる。
 * pre-hydration-calculator.js が拾うクラス名（calc-btn / submit-button / memo-input / category-select）は使わない。
 */
export function ExpenseItemsEditor({
  drafts,
  onChange,
  total,
  expenseCategory,
  spreadDifference,
  onSpreadDifferenceChange,
  onUseItemsTotal,
}: ExpenseItemsEditorProps) {
  const { categories, labelOf } = useCategories();
  const errorId = useId();
  const parsed = parseItemDrafts(drafts);
  const invalidKeys = new Set(parsed.ok ? [] : parsed.invalidKeys);
  const { itemsTotal, difference } = summarizeItemDrafts(drafts, total);
  // 未選択ならカテゴリーのない支出の計上先（その他。名前は変えられる）。一覧にない値（CSV から取り込んだ値など）はそのまま出す
  const expenseCategoryLabel = expenseCategory
    ? (labelOf(expenseCategory) ?? expenseCategory)
    : (labelOf(FALLBACK_CATEGORY) ?? 'その他');
  const hasRows = drafts.length > 0;

  const update = (key: string, patch: Partial<Omit<ItemDraft, 'key'>>) =>
    onChange(drafts.map((draft) => (draft.key === key ? updateItemDraft(draft, patch) : draft)));

  return (
    <div className="expense-items-editor">
      {hasRows && (
        <ul className="expense-items-rows">
          {drafts.map((draft, index) => {
            const invalid = invalidKeys.has(draft.key);
            const invalidProps = invalid ? { 'aria-invalid': true, 'aria-describedby': errorId } : {};
            return (
            <li key={draft.key} className={`expense-items-row${invalid ? ' expense-items-row-invalid' : ''}`}>
              <input
                type="text"
                className="expense-items-name"
                {...invalidProps}
                aria-label={`内訳${index + 1}の品名`}
                placeholder="品名"
                value={draft.name}
                onChange={(e) => update(draft.key, { name: e.target.value })}
              />
              <button
                type="button"
                className="expense-items-remove"
                aria-label={`内訳${index + 1}を削除`}
                onClick={() => onChange(drafts.filter((d) => d.key !== draft.key))}
              >
                ×
              </button>
              <input
                type="text"
                inputMode="numeric"
                className="expense-items-amount"
                {...invalidProps}
                aria-label={`内訳${index + 1}の金額`}
                placeholder="金額"
                value={draft.amount}
                onChange={(e) => update(draft.key, { amount: e.target.value })}
              />
              <select
                className="expense-items-category"
                aria-label={`内訳${index + 1}のカテゴリー`}
                value={draft.category}
                onChange={(e) => update(draft.key, { category: e.target.value })}
              >
                <option value="">会計と同じ（{expenseCategoryLabel}）</option>
                {categoryChoices(categories, draft.category).map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                className="expense-items-memo"
                {...invalidProps}
                aria-label={`内訳${index + 1}のメモ`}
                placeholder="メモ（任意）"
                maxLength={MAX_EXPENSE_ITEM_MEMO_LENGTH}
                value={draft.memo ?? ''}
                onChange={(e) => update(draft.key, { memo: e.target.value })}
              />
            </li>
            );
          })}
        </ul>
      )}

      <button type="button" className="expense-items-add" onClick={() => onChange([...drafts, newItemDraft()])}>
        ＋ 内訳を追加
      </button>

      {hasRows && (
        <div className="expense-items-summary">
          <p>
            内訳の合計 {formatYen(itemsTotal)}
            {total !== null && <> ／ 支払総額 {formatYen(total)}</>}
          </p>

          {difference !== null && difference > 0 && itemsTotal > 0 && (
            <>
              <label className="expense-items-spread">
                <input
                  type="checkbox"
                  checked={spreadDifference}
                  onChange={(e) => onSpreadDifferenceChange(e.target.checked)}
                />
                差額は消費税・値引き（内訳の金額の比率で配分する）
              </label>
              <p className="expense-items-note">
                {spreadDifference
                  ? `差額 ${formatYen(difference)} は、カテゴリー別の集計で内訳の金額の比率で配分します`
                  : `残り ${formatYen(difference)} は「${expenseCategoryLabel}」の分として内訳に1行加えて保存します`}
              </p>
            </>
          )}
          {difference !== null && difference > 0 && itemsTotal === 0 && (
            <p className="expense-items-note">金額のない内訳なので、支払総額は「{expenseCategoryLabel}」に計上します</p>
          )}
          {difference !== null && difference < 0 && (
            <p className="expense-items-note">
              内訳の合計が支払総額を {formatYen(-difference)} 上回っています（値引きとして内訳の比率で配分します）
            </p>
          )}

          {onUseItemsTotal && itemsTotal > 0 && difference !== 0 && (
            <div className="expense-items-actions">
              <button type="button" onClick={() => onUseItemsTotal(itemsTotal)}>
                内訳の合計を支払総額にする
              </button>
            </div>
          )}
        </div>
      )}

      {!parsed.ok && (
        <p id={errorId} className="expense-items-error" role="alert">
          {parsed.error}
        </p>
      )}
    </div>
  );
}
