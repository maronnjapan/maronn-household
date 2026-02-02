import { useState } from 'react';
import { useBudgetAlertSettings } from '../hooks/use-budget-alerts';
import { trpc } from '../trpc/client';

/**
 * 予算アラート設定セクション
 */
export function BudgetAlertSection() {
  const [isAdding, setIsAdding] = useState(false);
  const [newPercent, setNewPercent] = useState('20');
  const [newAmount, setNewAmount] = useState('');

  const subscriptionQuery = trpc.getSubscription.useQuery();
  const {
    alerts,
    isLoading,
    createAlert,
    updateAlert,
    deleteAlert,
    isCreating,
    isDeleting,
  } = useBudgetAlertSettings();

  const isPremium = subscriptionQuery.data?.isPremium ?? false;
  const limits = subscriptionQuery.data?.limits;
  const enabledCount = alerts.filter((a) => a.isEnabled).length;
  const canAddMore = isPremium || (limits && enabledCount < limits.budgetAlerts);

  const handleAdd = async () => {
    const percent = parseInt(newPercent, 10);
    const amount = newAmount ? parseInt(newAmount, 10) : undefined;

    if (isNaN(percent) || percent < 1 || percent > 100) {
      alert('閾値は1〜100%の範囲で入力してください');
      return;
    }

    await createAlert({
      thresholdPercent: percent,
      thresholdAmount: amount,
    });

    setNewPercent('20');
    setNewAmount('');
    setIsAdding(false);
  };

  const handleToggle = async (id: string, currentEnabled: boolean) => {
    await updateAlert({ id, isEnabled: !currentEnabled });
  };

  const handleDelete = async (id: string) => {
    if (confirm('このアラートを削除しますか？')) {
      await deleteAlert({ id });
    }
  };

  return (
    <section className="settings-section">
      <h2>予算アラート</h2>
      <p className="section-description">
        予算の残りが設定した割合を下回ったときに警告を表示します
      </p>

      {!isPremium && limits && (
        <p className="limit-note">
          無料プランでは{limits.budgetAlerts}件まで設定できます（現在{enabledCount}件）。
          <a href="/premium">プレミアム</a>で無制限に。
        </p>
      )}

      {isLoading ? (
        <p>読込中...</p>
      ) : (
        <>
          <ul className="alert-list">
            {alerts.length === 0 ? (
              <li className="empty">アラートは設定されていません</li>
            ) : (
              alerts.map((alert) => (
                <li key={alert.id} className={alert.isEnabled ? '' : 'disabled'}>
                  <div className="alert-info">
                    <span className="alert-threshold">
                      残り{alert.thresholdPercent}%で通知
                    </span>
                    {alert.thresholdAmount && (
                      <span className="alert-amount">
                        または ¥{alert.thresholdAmount.toLocaleString()}以下
                      </span>
                    )}
                  </div>
                  <div className="alert-actions">
                    <button
                      className="btn-toggle"
                      onClick={() => handleToggle(alert.id, alert.isEnabled === 1)}
                      disabled={isDeleting}
                    >
                      {alert.isEnabled ? '無効化' : '有効化'}
                    </button>
                    <button
                      className="btn-delete"
                      onClick={() => handleDelete(alert.id)}
                      disabled={isDeleting}
                    >
                      削除
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>

          {isAdding ? (
            <div className="add-alert-form">
              <div className="form-row">
                <label>
                  残り
                  <input
                    type="number"
                    value={newPercent}
                    onChange={(e) => setNewPercent(e.target.value)}
                    min="1"
                    max="100"
                  />
                  %で通知
                </label>
              </div>
              <div className="form-row">
                <label>
                  または金額
                  <input
                    type="number"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    placeholder="任意"
                  />
                  円以下
                </label>
              </div>
              <div className="form-actions">
                <button
                  className="btn-cancel"
                  onClick={() => setIsAdding(false)}
                  disabled={isCreating}
                >
                  キャンセル
                </button>
                <button
                  className="btn-add"
                  onClick={handleAdd}
                  disabled={isCreating}
                >
                  {isCreating ? '追加中...' : '追加'}
                </button>
              </div>
            </div>
          ) : canAddMore ? (
            <button className="btn-new-alert" onClick={() => setIsAdding(true)}>
              新しいアラートを追加
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
