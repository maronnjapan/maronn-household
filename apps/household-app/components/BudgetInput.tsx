import { useState, type FormEvent } from 'react';
import { DEFAULT_BUDGET_AMOUNT } from '../lib/const';

interface BudgetInputProps {
  currentBudget?: number;
  month: string;
  onUpdate: (amount: number) => void | Promise<void>;
  isUpdating?: boolean;
  isLoading?: boolean;
  isAuthenticated?: boolean;
}

/**
 * 予算設定コンポーネント
 * 月の予算を設定する
 * 認証していない場合は編集不可、デフォルト予算を表示
 */
export function BudgetInput({ currentBudget, month, onUpdate, isUpdating = false, isLoading = false, isAuthenticated = true }: BudgetInputProps) {
  const [amount, setAmount] = useState(currentBudget?.toString() || '');
  const [isEditing, setIsEditing] = useState(false);

  // 表示する予算額（認証時はサーバーから取得した値、未認証時はデフォルト値）
  const displayBudget = isAuthenticated ? currentBudget : DEFAULT_BUDGET_AMOUNT;

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
              {displayBudget ? `¥${displayBudget.toLocaleString()}` : '未設定'}
              {!isAuthenticated && <span className="default-badge">（デフォルト）</span>}
            </p>
          )}
        </div>
        {isAuthenticated ? (
          <button type="button" onClick={handleEdit} className="edit-button" disabled={isLoading}>
            {displayBudget ? '変更' : '設定'}
          </button>
        ) : (
          <p className="auth-required-message">予算を変更するにはログインが必要です</p>
        )}
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
