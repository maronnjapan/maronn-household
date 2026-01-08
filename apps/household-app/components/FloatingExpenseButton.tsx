import { CalculatorIcon } from './CalculatorIcon';

interface FloatingExpenseButtonProps {
  onClick: () => void;
}

/**
 * フローティング支出入力ボタン
 * 画面右下に固定表示され、クリックで支出入力モーダルを開く
 */
export function FloatingExpenseButton({ onClick }: FloatingExpenseButtonProps) {
  return (
    <button
      className="floating-expense-button"
      onClick={onClick}
      aria-label="支出を記録"
    >
      <CalculatorIcon />
    </button>
  );
}
