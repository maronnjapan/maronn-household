import { trpc } from '../../trpc/client';
import { EXPENSE_CATEGORIES } from '../../constants/categories';
import './analysis.css';

/**
 * カテゴリ値からラベルを取得
 */
function getCategoryLabel(value: string): string {
  const category = EXPENSE_CATEGORIES.find((c) => c.value === value);
  return category?.label ?? value;
}

/**
 * カテゴリ別の色を取得
 */
function getCategoryColor(index: number): string {
  const colors = [
    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
    '#FF9F40', '#FF6384', '#C9CBCF', '#7BC225', '#E7E9ED',
    '#8B5CF6', '#EC4899',
  ];
  return colors[index % colors.length] ?? '#999';
}

/**
 * 金額をフォーマット（カンマ区切り）
 */
function formatCurrency(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`;
}

/**
 * 円グラフコンポーネント（SVGで描画）
 */
function PieChart({
  data,
}: {
  data: { category: string; amount: number; percentage: number }[];
}) {
  if (data.length === 0) {
    return (
      <div className="pie-chart-empty">
        <p>データがありません</p>
      </div>
    );
  }

  const size = 200;
  const center = size / 2;
  const radius = 80;

  // 円グラフのパスを生成
  let currentAngle = -90; // 12時の位置から開始
  const paths = data.map((item, index) => {
    const angle = (item.percentage / 100) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;

    // 小さすぎるセグメントはスキップ
    if (angle < 1) return null;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = center + radius * Math.cos(startRad);
    const y1 = center + radius * Math.sin(startRad);
    const x2 = center + radius * Math.cos(endRad);
    const y2 = center + radius * Math.sin(endRad);

    const largeArc = angle > 180 ? 1 : 0;

    const path = `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;

    return (
      <path
        key={item.category}
        d={path}
        fill={getCategoryColor(index)}
        stroke="#fff"
        strokeWidth="2"
      >
        <title>{`${getCategoryLabel(item.category)}: ${formatCurrency(item.amount)} (${item.percentage}%)`}</title>
      </path>
    );
  });

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="pie-chart">
      {paths}
    </svg>
  );
}

/**
 * 棒グラフコンポーネント
 */
function BarChart({
  data,
}: {
  data: { month: string; total: number; budget: number | null }[];
}) {
  if (data.length === 0) {
    return (
      <div className="bar-chart-empty">
        <p>データがありません</p>
      </div>
    );
  }

  const maxValue = Math.max(
    ...data.map((d) => Math.max(d.total, d.budget ?? 0))
  );

  return (
    <div className="bar-chart">
      {data.map((item) => {
        const totalHeight = maxValue > 0 ? (item.total / maxValue) * 100 : 0;
        const budgetHeight = item.budget && maxValue > 0 ? (item.budget / maxValue) * 100 : 0;

        return (
          <div key={item.month} className="bar-item">
            <div className="bar-container">
              {item.budget && (
                <div
                  className="bar budget-bar"
                  style={{ height: `${budgetHeight}%` }}
                  title={`予算: ${formatCurrency(item.budget)}`}
                />
              )}
              <div
                className={`bar total-bar ${item.budget && item.total > item.budget ? 'over-budget' : ''}`}
                style={{ height: `${totalHeight}%` }}
                title={`支出: ${formatCurrency(item.total)}`}
              />
            </div>
            <span className="bar-label">{item.month.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * カテゴリ別分析ページ
 */
export function Page() {
  const subscriptionQuery = trpc.getSubscription.useQuery();
  const categoryQuery = trpc.getCategoryAnalysis.useQuery({ months: 1 });
  const trendQuery = trpc.getMonthlyTrend.useQuery({ months: 6 });

  const isPremium = subscriptionQuery.data?.isPremium ?? false;

  return (
    <main className="analysis-page">
      <header className="analysis-header">
        <h1>支出分析</h1>
        {!isPremium && (
          <div className="premium-banner">
            <p>
              無料プランでは今月のデータのみ表示されます。
              <a href="/premium">プレミアムにアップグレード</a>
              すると全期間のデータを分析できます。
            </p>
          </div>
        )}
      </header>

      <section className="analysis-section">
        <h2>カテゴリ別支出</h2>
        {categoryQuery.isLoading ? (
          <p className="loading">読み込み中...</p>
        ) : categoryQuery.error ? (
          <p className="error">データの取得に失敗しました</p>
        ) : (
          <>
            <div className="category-chart-container">
              <PieChart data={categoryQuery.data?.analysis ?? []} />
              <div className="category-legend">
                {categoryQuery.data?.analysis.map((item, index) => (
                  <div key={item.category} className="legend-item">
                    <span
                      className="legend-color"
                      style={{ backgroundColor: getCategoryColor(index) }}
                    />
                    <span className="legend-label">
                      {getCategoryLabel(item.category)}
                    </span>
                    <span className="legend-value">
                      {formatCurrency(item.amount)}
                    </span>
                    <span className="legend-percent">
                      ({item.percentage}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="category-total">
              <span>合計:</span>
              <strong>{formatCurrency(categoryQuery.data?.total ?? 0)}</strong>
            </div>
          </>
        )}
      </section>

      <section className="analysis-section">
        <h2>月別推移</h2>
        {trendQuery.isLoading ? (
          <p className="loading">読み込み中...</p>
        ) : trendQuery.error ? (
          <p className="error">データの取得に失敗しました</p>
        ) : (
          <>
            <BarChart data={trendQuery.data?.trends ?? []} />
            <div className="chart-legend">
              <span className="legend-item">
                <span className="legend-color budget" />
                予算
              </span>
              <span className="legend-item">
                <span className="legend-color spent" />
                支出
              </span>
            </div>
            {trendQuery.data?.isPremiumRequired && (
              <p className="premium-hint">
                より長期間のデータを見るには
                <a href="/premium">プレミアムプラン</a>
                が必要です。
              </p>
            )}
          </>
        )}
      </section>

      <section className="analysis-section">
        <h2>カテゴリ別詳細</h2>
        {categoryQuery.isLoading ? (
          <p className="loading">読み込み中...</p>
        ) : (
          <table className="category-table">
            <thead>
              <tr>
                <th>カテゴリ</th>
                <th>金額</th>
                <th>割合</th>
              </tr>
            </thead>
            <tbody>
              {categoryQuery.data?.analysis.map((item) => (
                <tr key={item.category}>
                  <td>{getCategoryLabel(item.category)}</td>
                  <td className="amount">{formatCurrency(item.amount)}</td>
                  <td className="percent">{item.percentage}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
