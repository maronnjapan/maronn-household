import './celebration-modal.css';

interface CelebrationModalProps {
  /** 対象月（予算内で終了した前月、YYYY-MM形式） */
  targetMonth: string;
  /** 前月の予算 */
  budget: number;
  /** 前月の支出合計 */
  spent: number;
  /** 前月の残額（予算 - 支出） */
  remaining: number;
  /** 閉じるハンドラ */
  onClose: () => void;
}

/**
 * 月初祝福モーダル
 * 前月の予算内達成を祝福する画面
 */
export function CelebrationModal({
  targetMonth,
  budget,
  spent,
  remaining,
  onClose,
}: CelebrationModalProps) {
  // YYYY-MM を 年月表示に変換
  const [year, month] = targetMonth.split('-').map(Number);
  const displayMonth = `${year}年${month}月`;

  // 金額を日本円フォーマット
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: 'JPY',
    }).format(amount);
  };

  return (
    <div className="celebration-overlay" onClick={onClose}>
      <div
        className="celebration-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="celebration-title"
      >
        <div className="celebration-content">
          <div className="celebration-icon">&#127881;</div>

          <h2 id="celebration-title" className="celebration-title">
            おめでとうございます!
          </h2>

          <p className="celebration-message">
            {displayMonth}は予算内で過ごせました
          </p>

          <div className="celebration-summary">
            <div className="summary-item">
              <span className="summary-label">予算</span>
              <span className="summary-value">{formatCurrency(budget)}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">支出</span>
              <span className="summary-value">{formatCurrency(spent)}</span>
            </div>
            <div className="summary-item highlight">
              <span className="summary-label">残額</span>
              <span className="summary-value positive">
                +{formatCurrency(remaining)}
              </span>
            </div>
          </div>

          <p className="celebration-encouragement">
            今月も頑張りましょう!
          </p>

          <button
            type="button"
            className="celebration-close-button"
            onClick={onClose}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
