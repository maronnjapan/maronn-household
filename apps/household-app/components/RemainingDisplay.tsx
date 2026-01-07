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

/**
 * 残額表示コンポーネント
 * 予算、支出、残額をリアルタイムで表示
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

      <div className="daily-info">
        <div className="daily-average">
          <span className="label">一日平均:</span>
          <span className="value">{formatCurrency(Math.floor(dailyAverage))}</span>
        </div>
        <div className="daily-limit">
          <span className="label">一日使用可能額:</span>
          <span className="value">{formatCurrency(Math.floor(dailyLimit))}</span>
        </div>
      </div>

      <div className="today-info">
        <div className="today-remaining">
          <span className="label">今日の残り:</span>
          <span className={`value ${todayRemaining < 0 ? 'negative' : ''}`}>
            {formatCurrency(Math.floor(todayRemaining))}
          </span>
        </div>
        <div className="budget-pace">
          <span className="label">予算ペース対比:</span>
          <span className={`value ${budgetPaceComparison < 0 ? 'negative' : 'positive'}`}>
            {budgetPaceComparison >= 0 ? '+' : ''}{formatCurrency(Math.floor(budgetPaceComparison))}
          </span>
        </div>
      </div>
    </div>
  );
}
