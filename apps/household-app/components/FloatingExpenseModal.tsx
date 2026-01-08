import type { CreateExpenseParams } from '@maronn/domain';
import { ExpenseInput } from './ExpenseInput';
import { useAddExpense } from '../hooks/use-add-expense';

interface FloatingExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * フローティング支出入力モーダル
 * ExpenseInput（電卓UI）をモーダルで表示
 * 送信後に自動でモーダルを閉じる
 */
export function FloatingExpenseModal({ isOpen, onClose }: FloatingExpenseModalProps) {
  const { addExpense } = useAddExpense();

  const handleAdd = async (params: CreateExpenseParams) => {
    await addExpense(params);
    onClose(); // 送信成功後にモーダルを閉じる
  };

  if (!isOpen) return null;

  return (
    <div className="floating-modal-overlay" onClick={onClose}>
      <div className="floating-modal" onClick={(e) => e.stopPropagation()}>
        <div className="floating-modal-header">
          <h3>支出を記録</h3>
          <button className="floating-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="floating-modal-body">
          <ExpenseInput onAdd={handleAdd} />
        </div>
      </div>
    </div>
  );
}
