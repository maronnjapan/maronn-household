import { CalculatorIcon } from './CalculatorIcon';
import { useHandPreference } from '../hooks/use-hand-preference';

interface FloatingExpenseButtonProps {
  onClick: () => void;
}

/**
 * フローティング支出入力ボタン
 * 画面右下（左利きの場合は左下）に固定表示され、クリックで支出入力モーダルを開く
 */
export function FloatingExpenseButton({ onClick }: FloatingExpenseButtonProps) {
  console.log('localStorage handPreference:', localStorage.getItem('handPreference'));
  const { isLeftHanded } = useHandPreference();

  return (
    <button
      className={`floating-expense-button ${isLeftHanded ? 'left-handed' : ''}`}
      onClick={onClick}
      aria-label="支出を記録"
    >
      <CalculatorIcon />
    </button>
  );
}
