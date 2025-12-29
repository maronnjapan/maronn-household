import { RemainingDisplay } from '../../components/RemainingDisplay';
import { ExpenseInput } from '../../components/ExpenseInput';
import { BudgetInput } from '../../components/BudgetInput';
import { useRemainingBudget } from '../../hooks/use-remaining-budget';
import { useAddExpense } from '../../hooks/use-add-expense';
import { useSetBudget } from '../../hooks/use-set-budget';
import type { CreateExpenseParams } from '@maronn/domain';

/**
 * 家計簿ページ - 爆速表示の家計簿
 * IndexedDB からローカルファースト取得 (< 500ms)
 * 入力後の残額更新は瞬時 (< 50ms)
 */
export function Page() {
  // リアクティブに残額を取得（useLiveQuery）
  const { budget, spent, remaining, month, isLoading } = useRemainingBudget();

  // 支出追加フック
  const { addExpense } = useAddExpense();

  // 予算設定フック
  const { updateBudget, isUpdating } = useSetBudget();

  const handleAdd = async (params: CreateExpenseParams) => {
    await addExpense(params);
    // useLiveQuery が自動検知して RemainingDisplay が即座に更新される
  };

  const handleUpdateBudget = async (amount: number) => {
    await updateBudget(month, amount);
    // 予算更新後、IndexedDBが更新されて残額表示も自動更新される
  };

  return (
    <main className="home-page">
      <header>
        <h1>家計簿</h1>
        <p className="month">{month}</p>
      </header>

      <section className="budget-section">
        <h2>予算設定</h2>
        <BudgetInput
          currentBudget={budget}
          month={month}
          onUpdate={handleUpdateBudget}
          isUpdating={isUpdating}
        />
      </section>

      <section className="remaining-section">
        <RemainingDisplay
          budget={budget}
          spent={spent}
          remaining={remaining}
          isLoading={isLoading}
        />
      </section>

      <section className="input-section">
        <h2>支出を記録</h2>
        <ExpenseInput onAdd={handleAdd} />
      </section>

      <footer>
        <p className="performance-note">
          ⚡ ローカルファースト - オフラインでも爆速動作
        </p>
      </footer>
    </main>
  );
}
