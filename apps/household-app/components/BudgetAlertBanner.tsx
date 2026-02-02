import { useBudgetAlerts } from '../hooks/use-budget-alerts';

interface BudgetAlertBannerProps {
  budget: number;
  remaining: number;
}

/**
 * 予算アラートバナーコンポーネント
 * 予算の残額が閾値を下回った場合に警告を表示
 */
export function BudgetAlertBanner({ budget, remaining }: BudgetAlertBannerProps) {
  const { alerts, hasAlerts, isLoading } = useBudgetAlerts(budget, remaining);

  if (isLoading || !hasAlerts) {
    return null;
  }

  // 最も重要なアラート（最低の閾値）を表示
  const primaryAlert = alerts[0];
  if (!primaryAlert) {
    return null;
  }

  const remainingPercent = budget > 0 ? Math.round((remaining / budget) * 100) : 100;
  const isNegative = remaining < 0;

  return (
    <div className={`budget-alert-banner ${isNegative ? 'danger' : 'warning'}`}>
      <div className="alert-icon">
        {isNegative ? '!!' : '!'}
      </div>
      <div className="alert-content">
        <p className="alert-message">
          {isNegative
            ? '予算をオーバーしています！'
            : primaryAlert.message}
        </p>
        <p className="alert-detail">
          残り {remainingPercent}%（¥{remaining.toLocaleString()}）
        </p>
      </div>
      <a href="/settings" className="alert-settings">
        設定
      </a>
    </div>
  );
}
