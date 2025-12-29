import { useState, type FormEvent } from 'react';
import type { CreateExpenseParams } from '@maronn/domain';

interface ExpenseInputProps {
  onAdd: (params: CreateExpenseParams) => void | Promise<void>;
}

/**
 * 支出入力コンポーネント
 * 金額とメモを入力して即座に追加（< 50ms）
 */
export function ExpenseInput({ onAdd }: ExpenseInputProps) {
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const amountNum = parseInt(amount, 10);
    if (!amountNum || amountNum <= 0) {
      return;
    }

    // 支出を追加
    await onAdd({
      amount: amountNum,
      memo: memo.trim() || undefined,
    });

    // フォームをクリア
    setAmount('');
    setMemo('');
  };

  const isValid = amount !== '' && parseInt(amount, 10) > 0;

  return (
    <form onSubmit={handleSubmit} className="expense-input">
      <div className="input-group">
        <input
          type="number"
          inputMode="numeric"
          placeholder="金額"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="amount-input"
          min="1"
          step="1"
        />
        <input
          type="text"
          placeholder="メモ"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          className="memo-input"
        />
      </div>
      <button type="submit" disabled={!isValid} className="add-button">
        追加
      </button>
    </form>
  );
}
