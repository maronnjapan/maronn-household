import Dexie, { type Table } from 'dexie';
import type { ExpenseEntity, SyncStatus } from '@maronn/domain';

/**
 * 予算エンティティ
 */
export interface BudgetEntity {
  id: string;
  month: string; // 'YYYY-MM'
  amount: number;
  updatedAt: string; // ISO 8601
}

/**
 * 同期メタデータ
 */
export interface SyncMeta {
  id: 'main';
  lastSyncedAt: string;
  deviceId: string;
}

/**
 * IndexedDB データベース
 */
export class HouseholdDB extends Dexie {
  expenses!: Table<ExpenseEntity>;
  budgets!: Table<BudgetEntity>;
  syncMeta!: Table<SyncMeta>;

  constructor() {
    super('maronn-household');

    // IndexedDB schema definition
    // Format: 'primaryKey, index1, index2, ...'
    // Indexes enable fast queries on specific fields
    this.version(1).stores({
      expenses: 'id, date, syncStatus, createdAt', // Primary: id, Indexes: date (for month queries), syncStatus (for pending sync), createdAt (for sorting)
      budgets: 'id, month, updatedAt', // Primary: id (month), Indexes: month (for lookups), updatedAt (for conflict resolution)
      syncMeta: 'id', // Primary: id (singleton for sync state)
    });
  }
}

// シングルトンインスタンス
export const db = new HouseholdDB();

/**
 * 現在の月を YYYY-MM 形式で取得
 */
export function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * 指定月の予算を取得（なければデフォルト値を返す）
 */
export async function getBudget(
  month: string,
  defaultAmount = 0
): Promise<BudgetEntity> {
  const existing = await db.budgets.get(month);
  if (existing) {
    return existing;
  }

  // デフォルト予算を作成
  const budget: BudgetEntity = {
    id: month,
    month,
    amount: defaultAmount,
    updatedAt: new Date().toISOString(),
  };

  return budget;
}

/**
 * 予算を更新
 */
export async function setBudget(
  month: string,
  amount: number
): Promise<BudgetEntity> {
  const budget: BudgetEntity = {
    id: month,
    month,
    amount,
    updatedAt: new Date().toISOString(),
  };

  await db.budgets.put(budget);
  return budget;
}

/**
 * 指定月の支出を取得
 */
export async function getExpensesByMonth(month: string): Promise<ExpenseEntity[]> {
  // month は 'YYYY-MM' 形式
  const startDate = `${month}-01`;
  const year = parseInt(month.split('-')[0] as string);
  const monthNum = parseInt(month.split('-')[1] as string);
  const nextMonth = monthNum === 12 ? `${year + 1}-01` : `${year}-${String(monthNum + 1).padStart(2, '0')}`;
  const endDate = `${nextMonth}-01`;

  return db.expenses
    .where('date')
    .between(startDate, endDate, true, false)
    .toArray();
}

/**
 * 支出を追加
 */
export async function addExpense(expense: ExpenseEntity): Promise<string> {
  await db.expenses.add(expense);
  return expense.id;
}

/**
 * 同期ステータスを更新
 */
export async function updateSyncStatus(
  id: string,
  status: SyncStatus
): Promise<void> {
  await db.expenses.update(id, { syncStatus: status });
}

/**
 * 支出を更新
 */
export async function updateExpense(
  id: string,
  updates: Partial<Pick<ExpenseEntity, 'amount' | 'memo' | 'category' | 'date'>>
): Promise<ExpenseEntity | null> {
  const existing = await db.expenses.get(id);
  if (!existing) {
    return null;
  }

  const updatedExpense: ExpenseEntity = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
    syncStatus: 'pending',
  };

  await db.expenses.put(updatedExpense);
  return updatedExpense;
}

/**
 * 支出を削除
 */
export async function deleteExpense(id: string): Promise<boolean> {
  const existing = await db.expenses.get(id);
  if (!existing) {
    return false;
  }

  await db.expenses.delete(id);
  return true;
}

/**
 * サーバーからの支出データをIndexedDBにマージ
 * 既存データよりも新しいデータのみ更新する
 */
export async function mergeExpensesFromServer(
  serverExpenses: ExpenseEntity[]
): Promise<void> {
  if (serverExpenses.length === 0) return;

  await db.transaction('rw', db.expenses, async () => {
    for (const serverExpense of serverExpenses) {
      const localExpense = await db.expenses.get(serverExpense.id);

      if (!localExpense) {
        // ローカルに存在しない場合は追加（同期済みとしてマーク）
        await db.expenses.add({
          ...serverExpense,
          syncStatus: 'synced',
        });
      } else if (new Date(serverExpense.updatedAt) > new Date(localExpense.updatedAt)) {
        // サーバーのデータが新しい場合は更新
        await db.expenses.put({
          ...serverExpense,
          syncStatus: 'synced',
        });
      }
      // ローカルが新しい場合はそのまま（pendingのまま）
    }
  });
}
