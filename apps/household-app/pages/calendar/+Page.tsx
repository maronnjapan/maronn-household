import { useState } from 'react';
import type { ExpenseEntity } from '@maronn/domain';
import { Calendar } from '../../components/Calendar';
import { useCalendarExpenses, type DayExpenses } from '../../hooks/use-calendar-expenses';
import { useExpenseActions } from '../../hooks/use-expense-actions';
import { useAddExpense } from '../../hooks/use-add-expense';
import './calendar.css';

/**
 * 金額をフォーマット（カンマ区切り）
 */
function formatCurrency(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`;
}

/**
 * 日付を表示用にフォーマット
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

interface EditingState {
  id: string;
  amount: string;
  memo: string;
}

interface AddingState {
  amount: string;
  memo: string;
}

export function Page() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<{ date: string } | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [adding, setAdding] = useState<AddingState | null>(null);

  const { expensesByDay, totalSpent, isLoading } = useCalendarExpenses(year, month);
  const { handleUpdateExpense, handleDeleteExpense } = useExpenseActions();
  const { addExpense } = useAddExpense();

  const handlePrevMonth = () => {
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else {
      setMonth(month - 1);
    }
  };

  const handleNextMonth = () => {
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(month + 1);
    }
  };

  const handleDayClick = (date: string, _expenses: DayExpenses | undefined) => {
    setSelectedDay({ date });
    setEditing(null);
    setDeletingId(null);
    setAdding(null);
  };

  const handleCloseModal = () => {
    setSelectedDay(null);
    setEditing(null);
    setDeletingId(null);
    setAdding(null);
  };

  const handleStartEdit = (expense: ExpenseEntity) => {
    setEditing({
      id: expense.id,
      amount: String(expense.amount),
      memo: expense.memo ?? '',
    });
    setDeletingId(null);
  };

  const handleCancelEdit = () => {
    setEditing(null);
  };

  const handleSaveEdit = async () => {
    if (!editing) return;

    const amount = parseInt(editing.amount, 10);
    if (isNaN(amount) || amount <= 0) {
      return;
    }

    const success = await handleUpdateExpense(editing.id, {
      amount,
      memo: editing.memo || undefined,
    });

    if (success) {
      setEditing(null);
      // モーダルを閉じて再度開くとデータが更新されている
      // useLiveQueryが自動で更新を検知するのでそのままでもOK
    }
  };

  const handleStartDelete = (id: string) => {
    setDeletingId(id);
    setEditing(null);
  };

  const handleCancelDelete = () => {
    setDeletingId(null);
  };

  const handleConfirmDelete = async () => {
    if (!deletingId) return;

    const success = await handleDeleteExpense(deletingId);

    if (success) {
      setDeletingId(null);
    }
  };

  const handleStartAdd = () => {
    setAdding({ amount: '', memo: '' });
    setEditing(null);
    setDeletingId(null);
  };

  const handleCancelAdd = () => {
    setAdding(null);
  };

  const handleSaveAdd = async () => {
    if (!adding || !selectedDay) return;

    const amount = parseInt(adding.amount, 10);
    if (isNaN(amount) || amount <= 0) {
      return;
    }

    await addExpense({
      amount,
      memo: adding.memo || undefined,
      date: selectedDay.date,
    });

    setAdding(null);
  };

  // 現在選択中の日のデータを取得（リアルタイム更新対応）
  const currentDayExpenses = selectedDay
    ? expensesByDay.get(selectedDay.date)
    : null;

  return (
    <main className="calendar-page">
      <header>
        <h1>カレンダー</h1>
        <p className="total-spent">
          月の支出合計: {isLoading ? '読み込み中...' : formatCurrency(totalSpent)}
        </p>
      </header>

      <section className="calendar-section">
        {isLoading ? (
          <div className="loading">読み込み中...</div>
        ) : (
          <Calendar
            year={year}
            month={month}
            expensesByDay={expensesByDay}
            onPrevMonth={handlePrevMonth}
            onNextMonth={handleNextMonth}
            onDayClick={handleDayClick}
          />
        )}
      </section>

      {selectedDay && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{formatDate(selectedDay.date)}の支出</h3>
              <button className="modal-close" onClick={handleCloseModal}>
                ×
              </button>
            </div>
            <div className="modal-body">
              {currentDayExpenses && currentDayExpenses.expenses.length > 0 ? (
                <>
                  <ul className="expense-list">
                    {currentDayExpenses.expenses.map((expense) => (
                      <li key={expense.id} className="expense-item">
                        {editing?.id === expense.id ? (
                          // 編集モード
                          <div className="expense-edit-form">
                            <div className="edit-fields">
                              <input
                                type="number"
                                value={editing.amount}
                                onChange={(e) => setEditing({ ...editing, amount: e.target.value })}
                                placeholder="金額"
                                className="edit-input amount"
                              />
                              <input
                                type="text"
                                value={editing.memo}
                                onChange={(e) => setEditing({ ...editing, memo: e.target.value })}
                                placeholder="メモ"
                                className="edit-input memo"
                              />
                            </div>
                            <div className="edit-actions">
                              <button className="btn-save" onClick={handleSaveEdit}>保存</button>
                              <button className="btn-cancel" onClick={handleCancelEdit}>キャンセル</button>
                            </div>
                          </div>
                        ) : deletingId === expense.id ? (
                          // 削除確認モード
                          <div className="expense-delete-confirm">
                            <p>この支出を削除しますか？</p>
                            <p className="delete-target">{formatCurrency(expense.amount)} {expense.memo && `- ${expense.memo}`}</p>
                            <div className="delete-actions">
                              <button className="btn-delete-confirm" onClick={handleConfirmDelete}>削除</button>
                              <button className="btn-cancel" onClick={handleCancelDelete}>キャンセル</button>
                            </div>
                          </div>
                        ) : (
                          // 表示モード
                          <>
                            <div className="expense-info">
                              <span className="expense-amount">{formatCurrency(expense.amount)}</span>
                              {expense.memo && <span className="expense-memo">{expense.memo}</span>}
                            </div>
                            <div className="expense-actions">
                              <button className="btn-edit" onClick={() => handleStartEdit(expense)}>編集</button>
                              <button className="btn-delete" onClick={() => handleStartDelete(expense.id)}>削除</button>
                            </div>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="expense-total">
                    <span>合計</span>
                    <span>{formatCurrency(currentDayExpenses.total)}</span>
                  </div>
                </>
              ) : (
                <p className="no-expenses">この日の支出はありません</p>
              )}

              {/* 新規追加フォーム */}
              {adding ? (
                <div className="expense-add-form">
                  <div className="add-fields">
                    <input
                      type="number"
                      value={adding.amount}
                      onChange={(e) => setAdding({ ...adding, amount: e.target.value })}
                      placeholder="金額"
                      className="add-input amount"
                      autoFocus
                    />
                    <input
                      type="text"
                      value={adding.memo}
                      onChange={(e) => setAdding({ ...adding, memo: e.target.value })}
                      placeholder="メモ（任意）"
                      className="add-input memo"
                    />
                  </div>
                  <div className="add-actions">
                    <button className="btn-add-save" onClick={handleSaveAdd}>追加</button>
                    <button className="btn-cancel" onClick={handleCancelAdd}>キャンセル</button>
                  </div>
                </div>
              ) : (
                <button className="btn-add-new" onClick={handleStartAdd}>
                  + 支出を追加
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
