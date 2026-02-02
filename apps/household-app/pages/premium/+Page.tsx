import { trpc } from '../../trpc/client';
import {
  PREMIUM_PRICE_MONTHLY,
  PREMIUM_PRICE_YEARLY,
  FREE_PLAN_LIMITS,
} from '../../lib/subscription';
import './premium.css';

/**
 * 金額をフォーマット（カンマ区切り）
 */
function formatCurrency(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`;
}

/**
 * プレミアムプランページ
 */
export function Page() {
  const subscriptionQuery = trpc.getSubscription.useQuery();

  const isPremium = subscriptionQuery.data?.isPremium ?? false;

  const handleUpgrade = (plan: 'monthly' | 'yearly') => {
    // TODO: 決済処理を実装
    // Stripe などの決済サービスと連携
    alert(`${plan === 'monthly' ? '月額' : '年額'}プランへのアップグレードは準備中です`);
  };

  if (isPremium) {
    return (
      <main className="premium-page">
        <div className="premium-current">
          <div className="premium-badge">Premium</div>
          <h1>プレミアムプランをご利用中</h1>
          <p>すべての機能を無制限でご利用いただけます。</p>

          <section className="subscription-info">
            <h2>サブスクリプション情報</h2>
            <dl>
              <dt>プラン</dt>
              <dd>プレミアム</dd>
              <dt>開始日</dt>
              <dd>{subscriptionQuery.data?.subscription?.startedAt?.slice(0, 10) ?? '-'}</dd>
              {subscriptionQuery.data?.subscription?.expiresAt && (
                <>
                  <dt>有効期限</dt>
                  <dd>{subscriptionQuery.data.subscription.expiresAt.slice(0, 10)}</dd>
                </>
              )}
            </dl>
          </section>

          <a href="/settings" className="btn-settings">
            設定へ戻る
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="premium-page">
      <header className="premium-header">
        <h1>プレミアムプラン</h1>
        <p className="tagline">家計管理をもっと便利に、もっと賢く</p>
      </header>

      <section className="pricing-section">
        <div className="pricing-card monthly">
          <h2>月額プラン</h2>
          <div className="price">
            <span className="amount">{formatCurrency(PREMIUM_PRICE_MONTHLY)}</span>
            <span className="period">/月</span>
          </div>
          <ul className="features">
            <li>いつでも解約可能</li>
            <li>すべての機能が使い放題</li>
          </ul>
          <button className="btn-upgrade" onClick={() => handleUpgrade('monthly')}>
            月額プランで始める
          </button>
        </div>

        <div className="pricing-card yearly recommended">
          <div className="badge">2ヶ月分お得</div>
          <h2>年額プラン</h2>
          <div className="price">
            <span className="amount">{formatCurrency(PREMIUM_PRICE_YEARLY)}</span>
            <span className="period">/年</span>
          </div>
          <p className="monthly-equivalent">
            月あたり{formatCurrency(Math.floor(PREMIUM_PRICE_YEARLY / 12))}
          </p>
          <ul className="features">
            <li>年間{formatCurrency(PREMIUM_PRICE_MONTHLY * 12 - PREMIUM_PRICE_YEARLY)}お得</li>
            <li>すべての機能が使い放題</li>
          </ul>
          <button className="btn-upgrade" onClick={() => handleUpgrade('yearly')}>
            年額プランで始める
          </button>
        </div>
      </section>

      <section className="comparison-section">
        <h2>プラン比較</h2>
        <table className="comparison-table">
          <thead>
            <tr>
              <th>機能</th>
              <th>無料プラン</th>
              <th>プレミアム</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>支出記録</td>
              <td>無制限</td>
              <td>無制限</td>
            </tr>
            <tr>
              <td>予算設定</td>
              <td>無制限</td>
              <td>無制限</td>
            </tr>
            <tr>
              <td>カレンダー表示</td>
              <td>無制限</td>
              <td>無制限</td>
            </tr>
            <tr>
              <td>カテゴリ分析</td>
              <td>今月のみ</td>
              <td className="premium-feature">全期間</td>
            </tr>
            <tr>
              <td>月別推移グラフ</td>
              <td>{FREE_PLAN_LIMITS.categoryAnalysisMonths}ヶ月分</td>
              <td className="premium-feature">全期間</td>
            </tr>
            <tr>
              <td>定期支出</td>
              <td>{FREE_PLAN_LIMITS.recurringExpenses}件まで</td>
              <td className="premium-feature">無制限</td>
            </tr>
            <tr>
              <td>予算アラート</td>
              <td>{FREE_PLAN_LIMITS.budgetAlerts}件まで</td>
              <td className="premium-feature">無制限</td>
            </tr>
            <tr>
              <td>CSVエクスポート</td>
              <td>{FREE_PLAN_LIMITS.csvExportMonths}ヶ月分</td>
              <td className="premium-feature">全期間</td>
            </tr>
            <tr>
              <td>Webhook連携</td>
              <td>{FREE_PLAN_LIMITS.webhooks}件まで</td>
              <td className="premium-feature">無制限</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="features-section">
        <h2>プレミアム機能</h2>
        <div className="feature-cards">
          <div className="feature-card">
            <div className="feature-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path d="M18.375 2.25c-1.035 0-1.875.84-1.875 1.875v15.75c0 1.035.84 1.875 1.875 1.875h.75c1.035 0 1.875-.84 1.875-1.875V4.125c0-1.036-.84-1.875-1.875-1.875h-.75zM9.75 8.625c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v11.25c0 1.035-.84 1.875-1.875 1.875h-.75a1.875 1.875 0 01-1.875-1.875V8.625zM3 13.125c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v6.75c0 1.035-.84 1.875-1.875 1.875h-.75A1.875 1.875 0 013 19.875v-6.75z" />
              </svg>
            </div>
            <h3>詳細な分析</h3>
            <p>
              過去のすべてのデータを使って、カテゴリ別・月別の支出傾向を分析できます。
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z" clipRule="evenodd" />
              </svg>
            </div>
            <h3>定期支出の自動化</h3>
            <p>
              家賃やサブスクなど、毎月決まった支出を無制限に登録して自動で記録できます。
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path fillRule="evenodd" d="M5.25 9a6.75 6.75 0 0113.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 01-.297 1.206c-1.544.57-3.16.99-4.831 1.243a3.75 3.75 0 11-7.48 0 24.585 24.585 0 01-4.831-1.244.75.75 0 01-.298-1.205A8.217 8.217 0 005.25 9.75V9zm4.502 8.9a2.25 2.25 0 104.496 0 25.057 25.057 0 01-4.496 0z" clipRule="evenodd" />
              </svg>
            </div>
            <h3>予算アラート</h3>
            <p>
              残額が設定した閾値を下回ったときに通知。使いすぎを防ぎます。
            </p>
          </div>
        </div>
      </section>

      <section className="faq-section">
        <h2>よくある質問</h2>
        <div className="faq-list">
          <details>
            <summary>いつでも解約できますか？</summary>
            <p>
              はい、いつでも解約できます。解約後も期間終了まではプレミアム機能をご利用いただけます。
            </p>
          </details>
          <details>
            <summary>支払い方法は？</summary>
            <p>
              クレジットカード（Visa, Mastercard, JCB, American Express）でお支払いいただけます。
            </p>
          </details>
          <details>
            <summary>無料プランに戻したらデータはどうなりますか？</summary>
            <p>
              データはすべて保持されます。ただし、無料プランの制限を超える機能は利用できなくなります。
            </p>
          </details>
        </div>
      </section>

      <footer className="premium-footer">
        <a href="/household">家計簿に戻る</a>
      </footer>
    </main>
  );
}
