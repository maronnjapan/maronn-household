import { useState, useLayoutEffect } from 'react';
import { RemainingDisplay } from '../../components/RemainingDisplay';
import { ExpenseInput } from '../../components/ExpenseInput';
import { useRemainingBudget } from '../../hooks/use-remaining-budget';
import { useAddExpense } from '../../hooks/use-add-expense';
import type { CreateExpenseParams } from '@maronn/domain';
import './household.css';

/**
 * 家計簿ページ - 爆速表示の家計簿
 * IndexedDB からローカルファースト取得 (< 500ms)
 * 入力後の残額更新は瞬時 (< 50ms)
 */
export function Page() {
  // URL パラメータから金額を読み取り（Share Target API から受け取った金額）
  const [initialAmount, setInitialAmount] = useState<number | undefined>(undefined);

  // useLayoutEffect は例外的に使用（URL パラメータの読み取りとクリア）
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const amountParam = params.get('amount');

    if (amountParam) {
      const amount = parseInt(amountParam, 10);
      if (!isNaN(amount) && amount > 0) {
        setInitialAmount(amount);
      }

      // URL パラメータをクリア（履歴を汚さない）
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // リアクティブに残額を取得
  // 支出: IndexedDBからリアルタイム取得（< 50ms）
  // 予算: サーバーから取得（ネットワーク環境に依存）
  const { budget, spent, remaining, dailyAverage, dailyLimit, todayRemaining, budgetPaceComparison, month, isLoading } =
    useRemainingBudget();

  // 支出追加フック
  const { addExpense } = useAddExpense();

  const handleAdd = async (params: CreateExpenseParams) => {
    await addExpense(params);
    // useLiveQuery が自動検知して RemainingDisplay が即座に更新される
  };

  return (
    <main className="home-page">
      <header>
        <p className="month">{month}</p>
      </header>

      <section className="input-section">
        <h2>支出を記録</h2>
        <ExpenseInput onAdd={handleAdd} initialAmount={initialAmount} />
      </section>

      <section className="remaining-section">
        <RemainingDisplay
          budget={budget}
          spent={spent}
          remaining={remaining}
          dailyAverage={dailyAverage}
          dailyLimit={dailyLimit}
          todayRemaining={todayRemaining}
          budgetPaceComparison={budgetPaceComparison}
          isLoading={isLoading}
        />
      </section>

      <footer>
        <p className="performance-note">
          ⚡ ローカルファースト - オフラインでも爆速動作
        </p>
      </footer>
    </main>
  );
}
