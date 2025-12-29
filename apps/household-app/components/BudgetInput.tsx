import { useState, type FormEvent } from 'react';

interface BudgetInputProps {
  currentBudget?: number;
  month: string;
  onUpdate: (amount: number) => void | Promise<void>;
  isUpdating?: boolean;
  isLoading?: boolean;
}

/**
 * 予算設定コンポーネント
 * 月の予算を設定する
 */
export function BudgetInput({ currentBudget, month, onUpdate, isUpdating = false, isLoading = false }: BudgetInputProps) {
  const [amount, setAmount] = useState(currentBudget?.toString() || '');
  const [isEditing, setIsEditing] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const amountNum = parseInt(amount, 10);
    if (!amountNum || amountNum <= 0) {
      return;
    }

    await onUpdate(amountNum);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setAmount(currentBudget?.toString() || '');
    setIsEditing(false);
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  if (!isEditing) {
    return (
      <div className="budget-display">
        <div className="budget-info">
          <label>月の予算</label>
          {isLoading ? (
            <p className="budget-amount skeleton">読込中...</p>
          ) : (
            <p className="budget-amount">
              {currentBudget ? `¥${currentBudget.toLocaleString()}` : '未設定'}
            </p>
          )}
        </div>
        <button type="button" onClick={handleEdit} className="edit-button" disabled={isLoading}>
          {currentBudget ? '変更' : '設定'}
        </button>
      </div>
    );
  }

  const isValid = amount !== '' && parseInt(amount, 10) > 0;

  return (
    <form onSubmit={handleSubmit} className="budget-input">
      <div className="input-group">
        <label htmlFor="budget-amount">月の予算（{month}）</label>
        <input
          id="budget-amount"
          type="number"
          inputMode="numeric"
          placeholder="例: 120000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="budget-amount-input"
          min="1"
          step="1"
          disabled={isUpdating}
        />
      </div>
      <div className="button-group">
        <button type="submit" disabled={!isValid || isUpdating} className="save-button">
          {isUpdating ? '保存中...' : '保存'}
        </button>
        <button type="button" onClick={handleCancel} disabled={isUpdating} className="cancel-button">
          キャンセル
        </button>
      </div>
    </form>
  );
}
