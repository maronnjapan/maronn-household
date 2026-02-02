import { useState } from 'react';
import { trpc } from '../../trpc/client';
import { EXPENSE_CATEGORIES } from '../../constants/categories';
import { SUPPORTED_CURRENCIES, formatCurrencyAmount, deserializeExchangeRate } from '../../lib/exchange-rate';
import type { CurrencyCode } from '../../database/drizzle/schema/household';
import './recurring.css';

/**
 * 金額をフォーマット（カンマ区切り）
 */
function formatJPY(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`;
}

/**
 * カテゴリ値からラベルを取得
 */
function getCategoryLabel(value: string | null): string {
  if (!value) return '未分類';
  const category = EXPENSE_CATEGORIES.find((c) => c.value === value);
  return category?.label ?? value;
}

/**
 * 通貨コードからシンボルを取得
 */
function getCurrencySymbol(code: CurrencyCode): string {
  const currency = SUPPORTED_CURRENCIES.find((c) => c.code === code);
  return currency?.symbol ?? '¥';
}

/**
 * 定期支出入力フォーム
 */
function RecurringExpenseForm({
  onSubmit,
  onCancel,
  initialValues,
  isLoading,
}: {
  onSubmit: (data: {
    amount: number;
    category?: string;
    memo?: string;
    dayOfMonth: number;
    currency?: CurrencyCode;
  }) => void;
  onCancel: () => void;
  initialValues?: {
    amount: number;
    category: string | null;
    memo: string | null;
    dayOfMonth: number;
    currency?: CurrencyCode | null;
    originalAmount?: number | null;
  };
  isLoading: boolean;
}) {
  // 初期値の金額は、外貨の場合はoriginalAmountを使用（セント→ドル/ユーロに変換して表示）
  const getInitialAmount = () => {
    if (initialValues?.currency && initialValues.currency !== 'JPY' && initialValues.originalAmount) {
      return (initialValues.originalAmount / 100).toString();
    }
    return initialValues?.amount.toString() ?? '';
  };

  const [amount, setAmount] = useState(getInitialAmount());
  const [category, setCategory] = useState(initialValues?.category ?? '');
  const [memo, setMemo] = useState(initialValues?.memo ?? '');
  const [dayOfMonth, setDayOfMonth] = useState(
    initialValues?.dayOfMonth.toString() ?? '1'
  );
  const [currency, setCurrency] = useState<CurrencyCode>(
    (initialValues?.currency as CurrencyCode) ?? 'JPY'
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(amount);
    const dayNum = parseInt(dayOfMonth, 10);
    if (isNaN(amountNum) || amountNum <= 0) return;
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) return;

    // 外貨の場合はセント単位に変換
    let finalAmount = amountNum;
    if (currency !== 'JPY') {
      finalAmount = Math.round(amountNum * 100); // ドル/ユーロ → セント
    }

    onSubmit({
      amount: finalAmount,
      category: category || undefined,
      memo: memo || undefined,
      dayOfMonth: dayNum,
      currency,
    });
  };

  return (
    <form className="recurring-form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="currency">通貨</label>
        <select
          id="currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
        >
          {SUPPORTED_CURRENCIES.map((cur) => (
            <option key={cur.code} value={cur.code}>
              {cur.symbol} {cur.name}
            </option>
          ))}
        </select>
        {currency !== 'JPY' && (
          <p className="form-hint currency-hint">
            生成時に最新の為替レートで円換算されます
          </p>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="amount">
          金額 {currency !== 'JPY' && `(${getCurrencySymbol(currency)})`}
        </label>
        <div className="amount-input">
          <span className="currency-symbol">{getCurrencySymbol(currency)}</span>
          <input
            id="amount"
            type="number"
            step={currency === 'JPY' ? '1' : '0.01'}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={currency === 'JPY' ? '例: 10000' : '例: 9.99'}
            required
            min="0.01"
          />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="category">カテゴリ</label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">選択してください</option>
          {EXPENSE_CATEGORIES.map((cat) => (
            <option key={cat.value} value={cat.value}>
              {cat.label}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="memo">メモ</label>
        <input
          id="memo"
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="例: Netflix"
        />
      </div>

      <div className="form-group">
        <label htmlFor="dayOfMonth">支払日</label>
        <div className="day-input">
          <span>毎月</span>
          <input
            id="dayOfMonth"
            type="number"
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(e.target.value)}
            min="1"
            max="31"
            required
          />
          <span>日</span>
        </div>
        <p className="form-hint">
          31日を指定した場合、月によっては月末に調整されます
        </p>
      </div>

      <div className="form-actions">
        <button
          type="button"
          className="btn-cancel"
          onClick={onCancel}
          disabled={isLoading}
        >
          キャンセル
        </button>
        <button type="submit" className="btn-submit" disabled={isLoading}>
          {isLoading ? '保存中...' : '保存'}
        </button>
      </div>
    </form>
  );
}

/**
 * 定期支出管理ページ
 */
export function Page() {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const subscriptionQuery = trpc.getSubscription.useQuery();
  const listQuery = trpc.listRecurringExpenses.useQuery();
  const createMutation = trpc.createRecurringExpense.useMutation({
    onSuccess: () => {
      utils.listRecurringExpenses.invalidate();
      setIsAdding(false);
    },
  });
  const updateMutation = trpc.updateRecurringExpense.useMutation({
    onSuccess: () => {
      utils.listRecurringExpenses.invalidate();
      setEditingId(null);
    },
  });
  const deleteMutation = trpc.deleteRecurringExpense.useMutation({
    onSuccess: () => {
      utils.listRecurringExpenses.invalidate();
    },
  });
  const generateMutation = trpc.generateRecurringExpenses.useMutation({
    onSuccess: (data) => {
      if (data.count > 0) {
        alert(`${data.count}件の定期支出を今月分として生成しました`);
      } else {
        alert('生成する定期支出はありませんでした');
      }
    },
  });

  const isPremium = subscriptionQuery.data?.isPremium ?? false;
  const limits = subscriptionQuery.data?.limits;
  const recurringExpenses = listQuery.data?.recurringExpenses ?? [];
  const activeCount = recurringExpenses.filter((r) => r.isActive).length;
  const canAddMore = isPremium || (limits && activeCount < limits.recurringExpenses);

  const handleCreate = (data: {
    amount: number;
    category?: string;
    memo?: string;
    dayOfMonth: number;
    currency?: CurrencyCode;
  }) => {
    createMutation.mutate(data);
  };

  const handleUpdate = (
    id: string,
    data: {
      amount: number;
      category?: string;
      memo?: string;
      dayOfMonth: number;
      currency?: CurrencyCode;
    }
  ) => {
    updateMutation.mutate({ id, ...data });
  };

  const handleDelete = (id: string) => {
    if (confirm('この定期支出を削除しますか？')) {
      deleteMutation.mutate({ id });
    }
  };

  const handleToggleActive = (id: string, currentActive: number) => {
    updateMutation.mutate({ id, isActive: currentActive === 0 });
  };

  const handleGenerate = () => {
    if (confirm('今月分の定期支出を生成しますか？\n既に生成済みのものはスキップされます。')) {
      generateMutation.mutate();
    }
  };

  return (
    <main className="recurring-page">
      <header className="recurring-header">
        <h1>定期支出</h1>
        <p className="description">
          毎月決まった支出（家賃、サブスク等）を自動で記録します
        </p>
      </header>

      {!isPremium && limits && (
        <div className="limit-banner">
          <p>
            無料プランでは定期支出を{limits.recurringExpenses}件まで登録できます
            （現在{activeCount}件）。
            <a href="/premium">プレミアムプラン</a>で無制限に。
          </p>
        </div>
      )}

      <section className="recurring-actions">
        <button
          className="btn-generate"
          onClick={handleGenerate}
          disabled={generateMutation.isPending}
        >
          {generateMutation.isPending ? '生成中...' : '今月分を生成'}
        </button>
        {!isAdding && canAddMore && (
          <button className="btn-add" onClick={() => setIsAdding(true)}>
            新規追加
          </button>
        )}
      </section>

      {isAdding && (
        <section className="recurring-form-section">
          <h2>新規追加</h2>
          <RecurringExpenseForm
            onSubmit={handleCreate}
            onCancel={() => setIsAdding(false)}
            isLoading={createMutation.isPending}
          />
          {createMutation.error && (
            <p className="error-message">{createMutation.error.message}</p>
          )}
        </section>
      )}

      <section className="recurring-list">
        <h2>登録済みの定期支出</h2>
        {listQuery.isLoading ? (
          <p className="loading">読み込み中...</p>
        ) : recurringExpenses.length === 0 ? (
          <p className="empty">定期支出はまだ登録されていません</p>
        ) : (
          <ul>
            {recurringExpenses.map((item) => {
              const itemCurrency = (item.currency ?? 'JPY') as CurrencyCode;
              const exchangeRate = deserializeExchangeRate(item.lastExchangeRate);

              return (
                <li key={item.id} className={item.isActive ? '' : 'inactive'}>
                  {editingId === item.id ? (
                    <RecurringExpenseForm
                      onSubmit={(data) => handleUpdate(item.id, data)}
                      onCancel={() => setEditingId(null)}
                      initialValues={{
                        amount: item.amount,
                        category: item.category,
                        memo: item.memo,
                        dayOfMonth: item.dayOfMonth,
                        currency: itemCurrency,
                        originalAmount: item.originalAmount,
                      }}
                      isLoading={updateMutation.isPending}
                    />
                  ) : (
                    <div className="recurring-item">
                      <div className="item-main">
                        <span className="item-amount">
                          {formatJPY(item.amount)}
                        </span>
                        <span className="item-schedule">
                          毎月{item.dayOfMonth}日
                        </span>
                      </div>
                      {/* 外貨の場合は元の金額と為替レートを表示 */}
                      {itemCurrency !== 'JPY' && item.originalAmount && (
                        <div className="item-currency-info">
                          <span className="original-amount">
                            {getCurrencySymbol(itemCurrency)}{(item.originalAmount / 100).toFixed(2)}
                          </span>
                          {exchangeRate && (
                            <span className="exchange-rate">
                              @ {exchangeRate.rate.toFixed(2)}円/{itemCurrency}
                              <span className="rate-date">({exchangeRate.date})</span>
                            </span>
                          )}
                        </div>
                      )}
                      <div className="item-details">
                        <span className="item-category">
                          {getCategoryLabel(item.category)}
                        </span>
                        {item.memo && (
                          <span className="item-memo">{item.memo}</span>
                        )}
                      </div>
                      {!item.isActive && (
                        <span className="item-status">停止中</span>
                      )}
                      <div className="item-actions">
                        <button
                          className="btn-toggle"
                          onClick={() => handleToggleActive(item.id, item.isActive)}
                          disabled={updateMutation.isPending}
                        >
                          {item.isActive ? '停止' : '再開'}
                        </button>
                        <button
                          className="btn-edit"
                          onClick={() => setEditingId(item.id)}
                        >
                          編集
                        </button>
                        <button
                          className="btn-delete"
                          onClick={() => handleDelete(item.id)}
                          disabled={deleteMutation.isPending}
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="recurring-info">
        <h2>使い方</h2>
        <ol>
          <li>「新規追加」から定期支出を登録</li>
          <li>毎月「今月分を生成」をタップして支出を記録</li>
          <li>生成された支出は自動的にカレンダーに反映されます</li>
        </ol>
        <p className="info-note">
          ※ 同じ月に複数回「今月分を生成」を押しても、重複して記録されることはありません
        </p>
      </section>
    </main>
  );
}
