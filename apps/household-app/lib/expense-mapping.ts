/**
 * サーバー（tRPC）の支出の行と、ローカル（IndexedDB）の支出の変換
 *
 * サーバーから取ったデータは同期（sync.ts）と、記録・カレンダー画面のマージ（use-remaining-budget / use-calendar-expenses）で
 * ローカルに入れる。項目を写し漏らすと、マージでローカルの値（内訳など）が消えるので、変換はここ1か所で行う。
 */
import type { ExpenseEntity } from '@maronn/domain';
import { normalizeExpenseItems, type ExpenseItem, type ExpenseItemInput } from '@maronn/domain/expense-items';

/** getExpenses が返す支出の行 */
export interface ServerExpense {
  id: string;
  amount: number;
  category: string | null;
  memo: string | null;
  date: string;
  createdAt: string;
  updatedAt: string;
  deviceId: string;
  subBudgetId: string | null;
  /** 内訳（なければ null）。内訳を知らない古いサーバーは返さない */
  items?: readonly ExpenseItemInput[] | null;
  /** 店名（なければ null）。店名を知らない古いサーバーは返さない */
  storeName?: string | null;
}

export function toLocalExpense(row: ServerExpense): ExpenseEntity {
  return {
    id: row.id,
    amount: row.amount,
    category: row.category ?? undefined,
    memo: row.memo ?? undefined,
    date: row.date,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deviceId: row.deviceId,
    syncStatus: 'synced',
    subBudgetId: row.subBudgetId ?? undefined,
    // undefined（サーバーが内訳を返さない）は不明のまま、null・空は内訳なし
    items: row.items === undefined ? undefined : (normalizeExpenseItems(row.items) ?? null),
    // 内訳と同じく、undefined（サーバーが店名を返さない）は不明のまま、null は店名なし
    storeName: row.storeName,
  };
}

/**
 * createExpense（同期のアップサート）で送る内容
 * 内訳なし（null・空）なら null を送り、サーバーの内訳も消す。
 * 内訳が不明（undefined。内訳を知らないコードが書いた行）なら items を送らず、サーバーの内訳を変えない
 * （古い JS が内訳なしで取り込んだ行を編集して、サーバーの内訳を消さないように）。店名も同じ
 */
export function toUploadPayload(expense: ExpenseEntity): {
  id: string;
  amount: number;
  category: string | undefined;
  memo: string | undefined;
  date: string;
  createdAt: string;
  updatedAt: string;
  deviceId: string;
  subBudgetId: string | undefined;
  items?: ExpenseItem[] | null;
  storeName?: string | null;
} {
  return {
    id: expense.id,
    amount: expense.amount,
    category: expense.category,
    memo: expense.memo,
    date: expense.date,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
    deviceId: expense.deviceId,
    subBudgetId: expense.subBudgetId,
    items: expense.items === undefined ? undefined : expense.items && expense.items.length > 0 ? expense.items : null,
    // 不明（undefined）なら送らず、サーバーの店名を変えない。null なら消す
    storeName: expense.storeName,
  };
}
