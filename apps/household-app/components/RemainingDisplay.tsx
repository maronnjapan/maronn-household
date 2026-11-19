interface RemainingDisplayProps {
  budget: number;
  spent: number;
  remaining: number;
  dailyAverage: number;
  dailyLimit: number;
  todayRemaining: number;
  budgetPaceComparison: number;
  isLoading?: boolean;
}

/**
 * 金額をフォーマット（カンマ区切り）
 */
function formatCurrency(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`;
}

function negativeClass(amount: number): string | undefined {
  return amount < 0 ? 'negative' : undefined;
}

/**
 * 残額表示コンポーネント
 * 「残り」を大きく1つだけ見せ、その他の数値は小さな 2x2 のグリッドにまとめる。
 * 補助的な数値（一日平均・予算ペース対比）は「詳しく」の中に入れる。
 */
export function RemainingDisplay({
  budget,
  spent,
  remaining,
  dailyAverage,
  dailyLimit,
  todayRemaining,
  budgetPaceComparison,
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
      <h2 className="remaining-label">残り</h2>
      <p className={`remaining-value ${remaining < 0 ? 'negative' : ''}`}>
        {formatCurrency(remaining)}
      </p>

      <dl className="remaining-stats">
        <div className="remaining-stat">
          <dt>予算</dt>
          <dd>{formatCurrency(budget)}</dd>
        </div>
        <div className="remaining-stat">
          <dt>支出</dt>
          <dd>{formatCurrency(spent)}</dd>
        </div>
        <div className="remaining-stat">
          <dt>今日の残り</dt>
          <dd className={negativeClass(todayRemaining)}>
            {formatCurrency(Math.floor(todayRemaining))}
          </dd>
        </div>
        <div className="remaining-stat">
          <dt>1日の目安</dt>
          <dd className={negativeClass(dailyLimit)}>
            {formatCurrency(Math.floor(dailyLimit))}
          </dd>
        </div>
      </dl>

      <details className="remaining-details">
        <summary>詳しく</summary>
        <dl className="remaining-stats">
          <div className="remaining-stat">
            <dt>1日平均の支出</dt>
            <dd>{formatCurrency(Math.floor(dailyAverage))}</dd>
          </div>
          <div className="remaining-stat">
            <dt>予算ペース対比</dt>
            <dd className={negativeClass(budgetPaceComparison)}>
              {budgetPaceComparison >= 0 ? '+' : ''}
              {formatCurrency(Math.floor(budgetPaceComparison))}
            </dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
