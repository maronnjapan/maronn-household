interface RemainingDisplayProps {
  budget: number;
  spent: number;
  remaining: number;
  isLoading?: boolean;
}

/**
 * 金額をフォーマット（カンマ区切り）
 */
function formatCurrency(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`;
}

/**
 * 残額表示コンポーネント
 * 予算、支出、残額をリアルタイムで表示
 */
export function RemainingDisplay({
  budget,
  spent,
  remaining,
  isLoading = false,
}: RemainingDisplayProps) {
  if (isLoading) {
    return (
      <div className="remaining-display loading">
        <p>読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="remaining-display">
      <div className="summary">
        <div className="budget-info">
          <span className="label">予算:</span>
          <span className="value">{formatCurrency(budget)}</span>
        </div>
        <div className="spent-info">
          <span className="label">支出:</span>
          <span className="value">{formatCurrency(spent)}</span>
        </div>
      </div>

      <div className="remaining-info">
        <h2 className="remaining-label">残り</h2>
        <p className={`remaining-value ${remaining < 0 ? 'negative' : ''}`}>
          {formatCurrency(remaining)}
        </p>
      </div>
    </div>
  );
}
