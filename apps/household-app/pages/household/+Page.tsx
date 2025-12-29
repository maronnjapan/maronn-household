import { RemainingDisplay } from '../../components/RemainingDisplay';
import { ExpenseInput } from '../../components/ExpenseInput';
import { useRemainingBudget } from '../../hooks/use-remaining-budget';
import { useAddExpense } from '../../hooks/use-add-expense';
import type { CreateExpenseParams } from '@maronn/domain';

/**
 * 家計簿ページ - 爆速表示の家計簿
 * IndexedDB からローカルファースト取得 (< 500ms)
 * 入力後の残額更新は瞬時 (< 50ms)
 */
export function Page() {
  // リアクティブに残額を取得
  // 支出: IndexedDBからリアルタイム取得（< 50ms）
  // 予算: サーバーから取得（ネットワーク環境に依存）
  const { budget, spent, remaining, month, isLoading } = useRemainingBudget();

  // 支出追加フック
  const { addExpense } = useAddExpense();

  const handleAdd = async (params: CreateExpenseParams) => {
    await addExpense(params);
    // useLiveQuery が自動検知して RemainingDisplay が即座に更新される
  };

  return (
    <main className="home-page">
      <header>
        <h1>家計簿</h1>
        <p className="month">{month}</p>
      </header>

      <section className="input-section">
        <h2>支出を記録</h2>
        <ExpenseInput onAdd={handleAdd} />
      </section>

      <section className="remaining-section">
        <RemainingDisplay
          budget={budget}
          spent={spent}
          remaining={remaining}
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
