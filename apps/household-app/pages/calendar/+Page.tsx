import { useState } from 'react';
import type { ExpenseEntity } from '@maronn/domain';
import { MAX_STORE_NAME_LENGTH } from '@maronn/domain/store-name';
import { allocateExpenseByCategory } from '@maronn/domain/expense-items';
import { Calendar } from '../../components/Calendar';
import { useCalendarExpenses, type DayExpenses } from '../../hooks/use-calendar-expenses';
import { useExpenseActions } from '../../hooks/use-expense-actions';
import { useAddExpense } from '../../hooks/use-add-expense';
import { useGetBudget } from '../../hooks/use-set-budget';
import { CSVImporter } from '../../components/CSVImporter';
import {
  convertExpensesToCSV,
  downloadCSV,
  type ImportableExpense,
} from '../../lib/csv-parser';
import { draftsFromItems, finalizeItemDrafts, initialSpreadDifference, type ItemDraft } from '../../lib/expense-items';
import { editStoreNameField, storeNameFieldFrom, storeNameToSave, type StoreNameField } from '../../lib/store-name-field';
import { CategoryOptions } from '../../components/CategoryOptions';
import { ExpenseItemsEditor } from '../../components/ExpenseItemsEditor';
import { ExpenseItemsList } from '../../components/ExpenseItemsList';
import { useCategories } from '../../hooks/use-categories';
import { useSubBudgets } from '../../hooks/use-sub-budget';
import './calendar.css';
import { DEFAULT_BUDGET_AMOUNT } from '../../lib/const';

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
  /** 店名の欄（店名を知らない行では、欄に触れなければ店名を送らない） */
  storeName: StoreNameField;
  category: string;
  items: ItemDraft[];
  /**
   * 内訳を保存するか。端末が内訳を知っている（サーバーから内訳の情報を受け取った）か、内訳の欄を編集したときだけ送る。
   * 内訳を知らない古い JS が取り込んだ行で空の内訳を送ると、サーバーの内訳が消えるため
   */
  saveItems: boolean;
  spreadDifference: boolean;
}

interface AddingState {
  amount: string;
  memo: string;
  storeName: string;
  category: string;
  subBudgetId: string;
  items: ItemDraft[];
  spreadDifference: boolean;
}

/** 金額欄の値（支払総額）。正の整数でなければ null */
function parseTotal(input: string): number | null {
  const amount = parseInt(input, 10);
  return isNaN(amount) || amount <= 0 ? null : amount;
}

export function Page() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<{ date: string } | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [adding, setAdding] = useState<AddingState | null>(null);
  const [showCSVImporter, setShowCSVImporter] = useState(false);

  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const { expensesByDay, totalSpent, isLoading, allExpenses } = useCalendarExpenses(year, month);
  const { budget } = useGetBudget(monthStr);
  const { handleUpdateExpense, handleDeleteExpense } = useExpenseActions();
  const { addExpense } = useAddExpense();
  const { subBudgets: subBudgetsList } = useSubBudgets();
  const { labelOf } = useCategories();

  // 月の日数を計算
  const daysInMonth = new Date(year, month, 0).getDate();

  // 1日あたりの予算を計算（デフォルト予算: 120,000円）
  const monthlyBudget = budget?.amount ?? DEFAULT_BUDGET_AMOUNT;
  const dailyBudget = monthlyBudget / daysInMonth;

  // CSVインポート処理
  async function handleCSVImport(expenses: ImportableExpense[]) {
    for (const expense of expenses) {
      await addExpense({
        amount: expense.amount,
        date: expense.date,
        memo: expense.memo as string | undefined,
        category: expense.category as string | undefined,
      });
    }
  }

  // CSVエクスポート処理
  function handleCSVExport() {
    if (allExpenses.length === 0) {
      alert('エクスポートするデータがありません');
      return;
    }

    const csvContent = convertExpensesToCSV(allExpenses, labelOf);
    const filename = `支出_${monthStr}.csv`;
    downloadCSV(csvContent, filename);
  }

  function handlePrevMonth() {
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else {
      setMonth(month - 1);
    }
  }

  function handleNextMonth() {
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(month + 1);
    }
  }

  function handleDayClick(date: string, _expenses: DayExpenses | undefined) {
    setSelectedDay({ date });
    setEditing(null);
    setDeletingId(null);
    setAdding(null);
  }

  function handleCloseModal() {
    setSelectedDay(null);
    setEditing(null);
    setDeletingId(null);
    setAdding(null);
  }

  function handleStartEdit(expense: ExpenseEntity) {
    setEditing({
      id: expense.id,
      amount: String(expense.amount),
      memo: expense.memo ?? '',
      storeName: storeNameFieldFrom(expense.storeName),
      category: expense.category ?? '',
      items: draftsFromItems(expense.items),
      saveItems: expense.items !== undefined,
      // 差を比率で配分している記録（レシートの消費税など）は、そのまま比率での配分を既定にする
      spreadDifference: initialSpreadDifference(expense.items, expense.amount),
    });
    setDeletingId(null);
  }

  function handleCancelEdit() {
    setEditing(null);
  }

  async function handleSaveEdit() {
    if (!editing) return;

    const amount = parseTotal(editing.amount);
    const items = finalizeItemDrafts(editing.items, amount, {
      spreadDifference: editing.spreadDifference,
      expenseCategory: editing.category,
    });
    if (amount === null || !items.ok) {
      return;
    }

    const success = await handleUpdateExpense(editing.id, {
      amount,
      memo: editing.memo || undefined,
      // 店名を消したときは空文字（null として保存し、サーバーの店名も消す）。店名を知らず編集もしていなければ変えない
      storeName: storeNameToSave(editing.storeName),
      category: editing.category || undefined,
      // 内訳をすべて消したときは null（サーバーの内訳も消す）。内訳を知らず編集もしていなければ送らない
      items: editing.saveItems ? (items.items ?? null) : undefined,
    });

    if (success) {
      setEditing(null);
    }
  }

  function handleStartDelete(id: string) {
    setDeletingId(id);
    setEditing(null);
  }

  function handleCancelDelete() {
    setDeletingId(null);
  }

  async function handleConfirmDelete() {
    if (!deletingId) return;

    const success = await handleDeleteExpense(deletingId);

    if (success) {
      setDeletingId(null);
    }
  }

  const handleStartAdd = () => {
    setAdding({
      amount: '',
      memo: '',
      storeName: '',
      category: '',
      subBudgetId: '',
      items: [],
      spreadDifference: false,
    });
    setEditing(null);
    setDeletingId(null);
  }

  function handleCancelAdd() {
    setAdding(null);
  }

  async function handleSaveAdd() {
    if (!adding || !selectedDay) return;

    const amount = parseTotal(adding.amount);
    const items = finalizeItemDrafts(adding.items, amount, {
      spreadDifference: adding.spreadDifference,
      expenseCategory: adding.category,
    });
    if (amount === null || !items.ok) {
      return;
    }

    await addExpense({
      amount,
      memo: adding.memo || undefined,
      storeName: adding.storeName || undefined,
      category: adding.category || undefined,
      date: selectedDay.date,
      subBudgetId: adding.subBudgetId || undefined,
      items: items.items,
    });

    setAdding(null);
  }

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
        <div className="calendar-actions">
          <button
            className="csv-import-btn"
            onClick={() => setShowCSVImporter(true)}
          >
            CSVインポート
          </button>
          <button
            className="csv-export-btn"
            onClick={handleCSVExport}
            disabled={isLoading || allExpenses.length === 0}
          >
            CSVエクスポート
          </button>
        </div>
      </header>

      <section className="calendar-section">
        {isLoading ? (
          <div className="loading">読み込み中...</div>
        ) : (
          <Calendar
            year={year}
            month={month}
            expensesByDay={expensesByDay}
            dailyBudget={dailyBudget}
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
                                placeholder="支払総額"
                                aria-label="支払総額"
                                className="edit-input amount"
                              />
                              <select
                                value={editing.category}
                                onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                                className="edit-input category"
                              >
                                <option value="">カテゴリー未選択</option>
                                <CategoryOptions selected={editing.category} />
                              </select>
                              <input
                                type="text"
                                value={editing.storeName.value}
                                onChange={(e) => setEditing({ ...editing, storeName: editStoreNameField(e.target.value) })}
                                placeholder="店名"
                                aria-label="店名"
                                maxLength={MAX_STORE_NAME_LENGTH}
                                className="edit-input store-name"
                              />
                              <input
                                type="text"
                                value={editing.memo}
                                onChange={(e) => setEditing({ ...editing, memo: e.target.value })}
                                placeholder="メモ"
                                aria-label="メモ"
                                className="edit-input memo"
                              />
                            </div>
                            <div className="expense-items-section">
                              <p className="expense-items-heading">内訳</p>
                              <ExpenseItemsEditor
                                drafts={editing.items}
                                onChange={(items) => setEditing({ ...editing, items, saveItems: true })}
                                total={parseTotal(editing.amount)}
                                expenseCategory={editing.category}
                                spreadDifference={editing.spreadDifference}
                                onSpreadDifferenceChange={(spreadDifference) => setEditing({ ...editing, spreadDifference })}
                                onUseItemsTotal={(itemsTotal) => setEditing({ ...editing, amount: String(itemsTotal) })}
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
                            <p className="delete-target">
                              {formatCurrency(expense.amount)}{' '}
                              {[expense.storeName, expense.memo].filter(Boolean).map((text) => `- ${text}`).join(' ')}
                            </p>
                            <div className="delete-actions">
                              <button className="btn-delete-confirm" onClick={handleConfirmDelete}>削除</button>
                              <button className="btn-cancel" onClick={handleCancelDelete}>キャンセル</button>
                            </div>
                          </div>
                        ) : (
                          // 表示モード
                          <>
                            <div className="expense-info">
                              <span className="expense-amount">
                                {formatCurrency(expense.amount)}
                                {expense.subBudgetId && (
                                  <span style={{ fontSize: '0.75rem', color: '#7b1fa2', marginLeft: '0.5rem' }}>
                                    (サブ予算)
                                  </span>
                                )}
                              </span>
                              {/* 内訳のある会計は、実際に計上されるカテゴリー（按分先）を出す。複数なら額も並べる */}
                              {expense.items && expense.items.length > 0 ? (
                                <span className="expense-category-list">
                                  {allocateExpenseByCategory(expense).map(({ category, amount }, _index, all) => (
                                    <span key={category} className="expense-category">
                                      {labelOf(category) ?? category}
                                      {all.length > 1 && ` ${formatCurrency(amount)}`}
                                    </span>
                                  ))}
                                </span>
                              ) : (
                                expense.category &&
                                labelOf(expense.category) && (
                                  <span className="expense-category">{labelOf(expense.category)}</span>
                                )
                              )}
                              {expense.storeName && <span className="expense-store-name">{expense.storeName}</span>}
                              {expense.memo && <span className="expense-memo">{expense.memo}</span>}
                              <ExpenseItemsList expense={expense} labelOf={labelOf} />
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
                    <div>
                      <div>メイン予算: {formatCurrency(currentDayExpenses.mainTotal)}</div>
                      {currentDayExpenses.subTotal > 0 && (
                        <div style={{ fontSize: '0.875rem', color: '#7b1fa2' }}>
                          サブ予算: {formatCurrency(currentDayExpenses.subTotal)}
                        </div>
                      )}
                    </div>
                    <div>
                      <div>合計: {formatCurrency(currentDayExpenses.total)}</div>
                    </div>
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
                      placeholder="支払総額"
                      aria-label="支払総額"
                      className="add-input amount"
                      autoFocus
                    />
                    <select
                      value={adding.category}
                      onChange={(e) => setAdding({ ...adding, category: e.target.value })}
                      className="add-input category"
                    >
                      <option value="">カテゴリー未選択</option>
                      <CategoryOptions selected={adding.category} />
                    </select>
                    <input
                      type="text"
                      value={adding.storeName}
                      onChange={(e) => setAdding({ ...adding, storeName: e.target.value })}
                      placeholder="店名（任意）"
                      aria-label="店名"
                      maxLength={MAX_STORE_NAME_LENGTH}
                      className="add-input store-name"
                    />
                    <input
                      type="text"
                      value={adding.memo}
                      onChange={(e) => setAdding({ ...adding, memo: e.target.value })}
                      placeholder="メモ（任意）"
                      aria-label="メモ"
                      className="add-input memo"
                    />
                    {subBudgetsList.length > 0 && (
                      <select
                        value={adding.subBudgetId}
                        onChange={(e) => setAdding({ ...adding, subBudgetId: e.target.value })}
                        className="add-input sub-budget"
                      >
                        <option value="">メイン予算</option>
                        {subBudgetsList.map((sb) => (
                          <option key={sb.id} value={sb.id}>
                            {sb.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="expense-items-section">
                    <p className="expense-items-heading">内訳（任意）</p>
                    <ExpenseItemsEditor
                      drafts={adding.items}
                      onChange={(items) => setAdding({ ...adding, items })}
                      total={parseTotal(adding.amount)}
                      expenseCategory={adding.category}
                      spreadDifference={adding.spreadDifference}
                      onSpreadDifferenceChange={(spreadDifference) => setAdding({ ...adding, spreadDifference })}
                      onUseItemsTotal={(itemsTotal) => setAdding({ ...adding, amount: String(itemsTotal) })}
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

      {showCSVImporter && (
        <CSVImporter
          onImport={handleCSVImport}
          onClose={() => setShowCSVImporter(false)}
        />
      )}
    </main>
  );
}
