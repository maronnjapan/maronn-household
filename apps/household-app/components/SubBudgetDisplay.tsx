import { useState } from 'react';
import { useSubBudgets, useSubBudgetDetail, useCreateSubBudget, useUpdateSubBudget, useDeleteSubBudget } from '../hooks/use-sub-budget';
import { getCurrentMonth } from '../lib/db';
import './sub-budget.css';

/**
 * 金額をフォーマット（カンマ区切り）
 */
function formatCurrency(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`;
}

interface SubBudgetCardProps {
  subBudgetId: string;
  month: string;
  onDelete: (id: string) => void;
}

function SubBudgetCard({ subBudgetId, month, onDelete }: SubBudgetCardProps) {
  const { detail, isLoading } = useSubBudgetDetail(subBudgetId, month);
  const { updateSubBudget, isUpdating } = useUpdateSubBudget();
  const [isEditing, setIsEditing] = useState(false);
  const [editAmount, setEditAmount] = useState('');
  const [editName, setEditName] = useState('');

  if (isLoading || !detail) {
    return <div className="sub-budget-card loading">読込中...</div>;
  }

  function handleStartEdit() {
    setEditAmount(String(detail!.monthlyAmount));
    setEditName(detail!.subBudget.name);
    setIsEditing(true);
  }

  async function handleSaveEdit() {
    const amount = parseInt(editAmount, 10);
    if (isNaN(amount) || amount < 0) return;

    const params: { name?: string; amount?: number } = {};
    if (editName !== detail!.subBudget.name) params.name = editName;
    if (amount !== detail!.monthlyAmount) params.amount = amount;

    if (Object.keys(params).length > 0) {
      await updateSubBudget(subBudgetId, params, month);
    }
    setIsEditing(false);
  }

  return (
    <div className="sub-budget-card">
      {isEditing ? (
        <div className="sub-budget-edit">
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="名前"
            className="sub-budget-name-input"
          />
          <input
            type="number"
            value={editAmount}
            onChange={(e) => setEditAmount(e.target.value)}
            placeholder="月額予算"
            className="sub-budget-amount-input"
          />
          <div className="sub-budget-edit-actions">
            <button onClick={handleSaveEdit} disabled={isUpdating} className="btn-save">
              保存
            </button>
            <button onClick={() => setIsEditing(false)} className="btn-cancel">
              キャンセル
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="sub-budget-header">
            <h3 className="sub-budget-name">{detail.subBudget.name}</h3>
            <div className="sub-budget-actions">
              <button onClick={handleStartEdit} className="btn-edit-small">変更</button>
              <button onClick={() => onDelete(subBudgetId)} className="btn-delete-small">削除</button>
            </div>
          </div>
          <div className="sub-budget-info">
            <div className="sub-budget-row">
              <span className="label">月額予算:</span>
              <span className="value">{formatCurrency(detail.monthlyAmount)}</span>
            </div>
            {detail.carryover !== 0 && (
              <div className="sub-budget-row">
                <span className="label">繰り越し:</span>
                <span className={`value ${detail.carryover < 0 ? 'negative' : 'positive'}`}>
                  {detail.carryover >= 0 ? '+' : ''}{formatCurrency(detail.carryover)}
                </span>
              </div>
            )}
            <div className="sub-budget-row">
              <span className="label">利用可能額:</span>
              <span className="value">{formatCurrency(detail.available)}</span>
            </div>
            <div className="sub-budget-row">
              <span className="label">今月の支出:</span>
              <span className="value">{formatCurrency(detail.spent)}</span>
            </div>
            <div className="sub-budget-row remaining">
              <span className="label">残り:</span>
              <span className={`value ${detail.remaining < 0 ? 'negative' : ''}`}>
                {formatCurrency(detail.remaining)}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * サブ予算表示・管理コンポーネント
 */
export function SubBudgetDisplay() {
  const month = getCurrentMonth();
  const { subBudgets, isLoading, isAuthenticated } = useSubBudgets();
  const { createSubBudget, isCreating } = useCreateSubBudget();
  const { deleteSubBudget } = useDeleteSubBudget();
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (!isAuthenticated) {
    return null;
  }

  async function handleCreateSubBudget() {
    const amount = parseInt(newAmount, 10);
    if (!newName.trim() || isNaN(amount) || amount < 0) return;

    await createSubBudget(newName.trim(), amount);
    setNewName('');
    setNewAmount('');
    setIsAdding(false);
  }

  async function handleConfirmDelete() {
    if (!deletingId) return;
    await deleteSubBudget(deletingId);
    setDeletingId(null);
  }

  return (
    <div className="sub-budget-display">
      <div className="sub-budget-title-row">
        <h2>サブ予算</h2>
        {!isAdding && (
          <button onClick={() => setIsAdding(true)} className="btn-add-sub-budget">
            + 追加
          </button>
        )}
      </div>

      {isAdding && (
        <div className="sub-budget-add-form">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="名前（例: 娯楽費）"
            className="sub-budget-name-input"
            autoFocus
          />
          <input
            type="number"
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
            placeholder="月額予算"
            className="sub-budget-amount-input"
          />
          <div className="sub-budget-add-actions">
            <button onClick={handleCreateSubBudget} disabled={isCreating} className="btn-save">
              作成
            </button>
            <button onClick={() => setIsAdding(false)} className="btn-cancel">
              キャンセル
            </button>
          </div>
        </div>
      )}

      {deletingId && (
        <div className="sub-budget-delete-confirm">
          <p>このサブ予算を削除しますか？紐づく支出はメイン予算に戻ります。</p>
          <div className="delete-actions">
            <button onClick={handleConfirmDelete} className="btn-delete-confirm">削除</button>
            <button onClick={() => setDeletingId(null)} className="btn-cancel">キャンセル</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="sub-budget-loading">読込中...</p>
      ) : subBudgets.length === 0 && !isAdding ? (
        <p className="sub-budget-empty">サブ予算はまだありません</p>
      ) : (
        <div className="sub-budget-list">
          {subBudgets.map((sb) => (
            <SubBudgetCard
              key={sb.id}
              subBudgetId={sb.id}
              month={month}
              onDelete={setDeletingId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
