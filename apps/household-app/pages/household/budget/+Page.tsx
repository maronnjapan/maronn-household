import { BudgetInput } from '../../../components/BudgetInput';
import { useSetBudget, useGetBudget } from '../../../hooks/use-set-budget';
import { getCurrentMonth } from '../../../lib/db';
import './budget.css';

/**
 * 予算設定ページ
 * 月次予算を設定・更新する専用ページ
 */
export function Page() {
  const month = getCurrentMonth();
  const { budget, isLoading, error } = useGetBudget(month);
  const { updateBudget, isUpdating } = useSetBudget();

  const handleUpdateBudget = async (amount: number) => {
    await updateBudget(month, amount);
  };

  return (
    <main className="budget-page">
      <header>
        <h1>予算設定</h1>
        <p className="month">{month}</p>
      </header>

      <section className="budget-section">
        {error ? (
          <div className="error-message">
            <p>予算の読み込みに失敗しました。</p>
            <p className="error-detail">{error.message}</p>
          </div>
        ) : null}

        <BudgetInput
          currentBudget={budget?.amount}
          month={month}
          onUpdate={handleUpdateBudget}
          isUpdating={isUpdating}
          isLoading={isLoading}
        />
      </section>

      <section className="info-section">
        <h2>予算設定について</h2>
        <ul>
          <li>月ごとに予算を設定できます</li>
          <li>設定した予算は家計簿ページで残額計算に使用されます</li>
          <li>予算が未設定の場合、デフォルト予算（120,000円）が使用されます</li>
        </ul>
      </section>
    </main>
  );
}
