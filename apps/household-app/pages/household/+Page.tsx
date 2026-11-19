import { RemainingDisplay } from '../../components/RemainingDisplay';
import { ExpenseInput } from '../../components/ExpenseInput';
import { CelebrationModal } from '../../components/CelebrationModal';
import { SubBudgetDisplay } from '../../components/SubBudgetDisplay';
import { useRemainingBudget } from '../../hooks/use-remaining-budget';
import { useAddExpense } from '../../hooks/use-add-expense';
import { useCelebration } from '../../hooks/use-celebration';
import type { CreateExpenseParams } from '@maronn/domain';
import './household.css';

/**
 * 'YYYY-MM' を「YYYY年M月」に整形する（形式が違う場合はそのまま返す）
 */
function formatMonthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  return `${match[1]}年${Number(match[2])}月`;
}

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

      {/* 金額入力を最初に表示する（最優先で描画・IndexedDB保存） */}
      <section className="input-section">
        <h2>支出を記録</h2>
        <ExpenseInput onAdd={handleAdd} />
      </section>

      <section className="remaining-section">
        <p className="remaining-month">{formatMonthLabel(month)}</p>
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

      <section className="sub-budget-section">
        <SubBudgetDisplay />
      </section>
    </main>
  );
}
