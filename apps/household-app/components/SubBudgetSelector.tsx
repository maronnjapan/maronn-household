import { useSubBudgets } from '../hooks/use-sub-budget';

interface SubBudgetSelectorProps {
  value: string;
  onChange: (subBudgetId: string) => void;
}

/**
 * サブ予算選択コンポーネント
 * 支出入力時にメイン予算かサブ予算かを選択する
 */
export function SubBudgetSelector({ value, onChange }: SubBudgetSelectorProps) {
  const { subBudgets, isAuthenticated } = useSubBudgets();

  // 未認証またはサブ予算がない場合は表示しない
  if (!isAuthenticated || subBudgets.length === 0) {
    return null;
  }

  return (
    <div className="sub-budget-selector">
      <label htmlFor="sub-budget-select" className="input-label">
        予算区分
      </label>
      <select
        id="sub-budget-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sub-budget-select"
      >
        <option value="">メイン予算</option>
        {subBudgets.map((sb) => (
          <option key={sb.id} value={sb.id}>
            {sb.name}
          </option>
        ))}
      </select>
    </div>
  );
}
