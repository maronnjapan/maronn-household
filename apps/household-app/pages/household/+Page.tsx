import { RemainingDisplay } from '../../components/RemainingDisplay';
import { ExpenseInput } from '../../components/ExpenseInput';
import { CelebrationModal } from '../../components/CelebrationModal';
import { BudgetAlertBanner } from '../../components/BudgetAlertBanner';
import { useRemainingBudget } from '../../hooks/use-remaining-budget';
import { useAddExpense } from '../../hooks/use-add-expense';
import { useCelebration } from '../../hooks/use-celebration';
import type { CreateExpenseParams } from '@maronn/domain';
import './household.css';

/**
 * 家計簿ページ - 爆速表示の家計簿
 * IndexedDB からローカルファースト取得 (< 500ms)
 * 入力後の残額更新は瞬時 (< 50ms)
 */
export function Page() {
  // リアクティブに残額を取得
  // 支出: IndexedDBからリアルタイム取得（< 50ms）
  // 予算: サーバーから取得（ネットワーク環境に依存）
  const { budget, spent, remaining, dailyAverage, dailyLimit, todayRemaining, budgetPaceComparison, month, isLoading } =
    useRemainingBudget();

  // 支出追加フック
  const { addExpense } = useAddExpense();

  // 月初祝福フック
  const celebration = useCelebration();

  const handleAdd = async (params: CreateExpenseParams) => {
    await addExpense(params);
    // useLiveQuery が自動検知して RemainingDisplay が即座に更新される
  };

  return (
    <main className="home-page">
      {/* 月初祝福モーダル */}
      {celebration.showCelebration && (
        <CelebrationModal
          targetMonth={celebration.targetMonth}
          budget={celebration.previousBudget}
          spent={celebration.previousSpent}
          remaining={celebration.previousRemaining}
          onClose={celebration.dismissCelebration}
        />
      )}

      <header>
        <p className="month">{month}</p>
      </header>

      {/* 予算アラートバナー */}
      <BudgetAlertBanner budget={budget} remaining={remaining} />

      <section className="input-section">
        <h2>支出を記録</h2>
        <ExpenseInput onAdd={handleAdd} />
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
          ローカルファースト - オフラインでも爆速動作
        </p>
      </footer>
    </main>
  );
}
