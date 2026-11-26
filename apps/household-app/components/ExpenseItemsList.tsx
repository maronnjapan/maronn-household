import { itemsTotal, type ExpenseItem } from '@maronn/domain/expense-items';

interface ExpenseItemsListProps {
  expense: { amount: number; category?: string; items?: ExpenseItem[] | null };
  /** カテゴリーの表示名（分からない値は undefined） */
  labelOf: (value: string) => string | undefined;
}

/** これ以下の件数なら最初から開いておく（多いと日のモーダルが長くなるので閉じておく） */
const OPEN_BY_DEFAULT_MAX_ITEMS = 5;

function formatYen(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`;
}

/**
 * 1回の会計の内訳（何を買ったか）の表示
 * 品名がなければカテゴリー名（内訳のカテゴリー → 会計のカテゴリー）で表す。金額が0の内訳は品名だけ。メモは品名の下に出す
 */
export function ExpenseItemsList({ expense, labelOf }: ExpenseItemsListProps) {
  const items = expense.items ?? [];
  if (items.length === 0) return null;

  const total = itemsTotal(items);
  const labelFor = (category: string | undefined) => (category ? (labelOf(category) ?? category) : undefined);

  return (
    <details className="expense-breakdown" open={items.length <= OPEN_BY_DEFAULT_MAX_ITEMS}>
      <summary className="expense-breakdown-summary">内訳 {items.length}件</summary>
      <ul className="expense-breakdown-items">
        {items.map((item, index) => {
          const categoryLabel = labelFor(item.category);
          return (
            <li key={index} className="expense-breakdown-item">
              <span className="expense-breakdown-name">
                {item.name || categoryLabel || labelFor(expense.category) || '内訳'}
                {item.quantity !== undefined && ` ×${item.quantity}`}
                {item.memo && <span className="expense-breakdown-memo">{item.memo}</span>}
              </span>
              {categoryLabel && item.name && <span className="expense-breakdown-category">{categoryLabel}</span>}
              {item.amount !== 0 && <span className="expense-breakdown-amount">{formatYen(item.amount)}</span>}
            </li>
          );
        })}
      </ul>
      {total > 0 && total < expense.amount && (
        <p className="expense-breakdown-note">
          内訳の合計 {formatYen(total)}（支払総額との差 {formatYen(expense.amount - total)} は内訳の比率で配分）
        </p>
      )}
      {total > expense.amount && (
        <p className="expense-breakdown-note">
          内訳の合計 {formatYen(total)}（支払総額より多い {formatYen(total - expense.amount)} は値引きとして内訳の比率で配分）
        </p>
      )}
    </details>
  );
}
