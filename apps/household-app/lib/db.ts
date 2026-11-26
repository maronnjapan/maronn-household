import Dexie, { type Table } from 'dexie';
import type { ExpenseEntity, SyncStatus } from '@maronn/domain';
import { normalizeExpenseItems, resolveExpenseCategories, type ExpenseItem } from '@maronn/domain/expense-items';
import { normalizeStoreName } from '@maronn/domain/store-name';
import { sameVersionRepair, withLocalFieldsUnknownToServer } from '@maronn/domain/sync';

/**
 * 未認証ユーザー用のID
 */
export const ANONYMOUS_USER_ID = 'anonymous';

/**
 * IndexedDB用の支出エンティティ（userIdを含む）
 * ログインユーザーと未認証ユーザーのデータを分離するため
 */
export interface LocalExpenseEntity extends ExpenseEntity {
  userId: string; // 認証ユーザーID or 'anonymous'
}

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
 * 月初祝福の表示済み記録
 * 月の予算内達成時に翌月初日に一回だけ祝福を表示するため
 */
export interface CelebrationShown {
  id: string; // 対象月 'YYYY-MM' (予算内で終了した月)
  shownAt: string; // 祝福を表示した日時（ISO 8601）
  userId: string; // ユーザーID
}

/**
 * IndexedDB データベース
 */
export class HouseholdDB extends Dexie {
  expenses!: Table<LocalExpenseEntity>;
  budgets!: Table<BudgetEntity>;
  syncMeta!: Table<SyncMeta>;
  celebrations!: Table<CelebrationShown>;

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

    // Version 2: userIdインデックスを追加（ユーザーごとのデータ分離用）
    this.version(2).stores({
      expenses: 'id, date, syncStatus, createdAt, userId, [userId+date]', // userIdと複合インデックスを追加
      budgets: 'id, month, updatedAt',
      syncMeta: 'id',
    });

    // Version 3: 月初祝福の表示済み記録を追加
    this.version(3).stores({
      expenses: 'id, date, syncStatus, createdAt, userId, [userId+date]',
      budgets: 'id, month, updatedAt',
      syncMeta: 'id',
      celebrations: 'id, userId, [userId+id]', // Primary: id (達成月), Indexes: userId, 複合インデックス
    });

    // Version 4: サブ予算対応（subBudgetIdインデックス追加）
    this.version(4).stores({
      expenses: 'id, date, syncStatus, createdAt, userId, [userId+date], subBudgetId',
      budgets: 'id, month, updatedAt',
      syncMeta: 'id',
      celebrations: 'id, userId, [userId+id]',
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
 * 指定月・指定ユーザーの支出を取得
 * @param month 対象月（YYYY-MM形式）
 * @param userId ユーザーID（未認証時はANONYMOUS_USER_ID）
 */
export async function getExpensesByMonth(
  month: string,
  userId: string = ANONYMOUS_USER_ID
): Promise<LocalExpenseEntity[]> {
  // month は 'YYYY-MM' 形式
  const startDate = `${month}-01`;
  const year = parseInt(month.split('-')[0] as string);
  const monthNum = parseInt(month.split('-')[1] as string);
  const nextMonth = monthNum === 12 ? `${year + 1}-01` : `${year}-${String(monthNum + 1).padStart(2, '0')}`;
  const endDate = `${nextMonth}-01`;

  return db.expenses
    .where('[userId+date]')
    .between([userId, startDate], [userId, endDate], true, false)
    .toArray();
}

/**
 * 支出を追加
 * @param expense 支出エンティティ
 * @param userId ユーザーID（未認証時はANONYMOUS_USER_ID）
 */
export async function addExpense(expense: ExpenseEntity, userId: string = ANONYMOUS_USER_ID): Promise<string> {
  const localExpense: LocalExpenseEntity = {
    ...expense,
    userId,
  };
  await db.expenses.add(localExpense);
  return expense.id;
}

/**
 * アップロードした版のままなら同期済みにする
 * 送っている間に編集された（updatedAt が変わった）支出は、次の同期で送るよう pending のままにする
 */
export async function markSyncedIfUnchanged(id: string, uploadedUpdatedAt: string): Promise<void> {
  await db.expenses
    .where('id')
    .equals(id)
    .and((expense) => expense.updatedAt === uploadedUpdatedAt)
    .modify({ syncStatus: 'synced' });
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
 * 支出の更新内容
 * items は undefined なら変えず、null（または空の配列）なら内訳を消し、配列なら置き換える。storeName も undefined なら変えない
 * （memo・category は従来どおり、undefined を渡すと消える）
 */
export type ExpenseUpdates = Partial<Pick<ExpenseEntity, 'amount' | 'memo' | 'category' | 'date'>> & {
  items?: ExpenseItem[] | null;
  /** 店名。undefined なら変えず、null や空文字なら消す */
  storeName?: string | null;
};

/**
 * 支出を更新
 * @param id 支出ID
 * @param updates 更新内容
 * @param userId ユーザーID（オプション、指定時はそのユーザーのデータのみ更新可能）
 */
export async function updateExpense(
  id: string,
  updates: ExpenseUpdates,
  userId?: string
): Promise<LocalExpenseEntity | null> {
  const existing = await db.expenses.get(id);
  if (!existing) {
    return null;
  }

  // userIdが指定されている場合、そのユーザーのデータのみ更新可能
  if (userId !== undefined && existing.userId !== userId) {
    return null;
  }

  // items・storeName は undefined をそのままスプレッドすると既存の値が消えるので、渡されたときだけ変える
  const { items, storeName, ...fields } = updates;
  const merged: LocalExpenseEntity = {
    ...existing,
    ...fields,
    ...(items !== undefined ? { items: normalizeExpenseItems(items) ?? null } : {}),
    ...(storeName !== undefined ? { storeName: normalizeStoreName(storeName) } : {}),
  };
  // 内訳があれば、会計のカテゴリー（なければ主なカテゴリー）と内訳のカテゴリーを確定する
  const resolved = resolveExpenseCategories(merged);
  const updatedExpense: LocalExpenseEntity = {
    ...merged,
    category: resolved.category,
    items: resolved.items,
    updatedAt: new Date().toISOString(),
    syncStatus: 'pending',
  };

  await db.expenses.put(updatedExpense);
  return updatedExpense;
}

/**
 * 支出を削除
 * @param id 支出ID
 * @param userId ユーザーID（オプション、指定時はそのユーザーのデータのみ削除可能）
 */
export async function deleteExpense(id: string, userId?: string): Promise<boolean> {
  const existing = await db.expenses.get(id);
  if (!existing) {
    return false;
  }

  // userIdが指定されている場合、そのユーザーのデータのみ削除可能
  if (userId !== undefined && existing.userId !== userId) {
    return false;
  }

  await db.expenses.delete(id);
  return true;
}

/**
 * サーバーからの支出データをIndexedDBにマージ
 * - サーバーにあってローカルにないデータは追加
 * - サーバーのデータがローカルより新しい場合は更新
 * - ローカルにあってサーバーにないデータ（削除された）は削除
 *   ただし、syncStatus: 'pending' のデータは保持（まだ同期されていない）
 *
 * @param serverExpenses サーバーから取得した支出データ
 * @param month 対象月（YYYY-MM形式）。指定すると、その月のローカルデータで
 *              サーバーに存在しないものを削除する
 * @param userId ユーザーID（認証ユーザーのデータのみマージ）
 */
export async function mergeExpensesFromServer(
  serverExpenses: ExpenseEntity[],
  month?: string,
  userId?: string
): Promise<void> {
  // userIdが指定されていない場合はマージしない（認証時のみマージ）
  if (!userId) {
    return;
  }

  await db.transaction('rw', db.expenses, async () => {
    // サーバーにあるデータのIDセット
    const serverIds = new Set(serverExpenses.map((e) => e.id));

    // サーバーのデータをローカルにマージ
    for (const serverExpense of serverExpenses) {
      const localExpense = await db.expenses.get(serverExpense.id);

      if (!localExpense) {
        // ローカルに存在しない場合は追加（同期済みとしてマーク）
        await db.expenses.add({
          ...serverExpense,
          userId,
          syncStatus: 'synced',
        });
      } else if (localExpense.userId === userId && new Date(serverExpense.updatedAt) > new Date(localExpense.updatedAt)) {
        // サーバーのデータが新しい場合は更新（同じユーザーのデータのみ）
        // サーバーが内訳・店名を返さない（その項目を知らない古いサーバー）ときは、ローカルの値を残す
        await db.expenses.put({
          ...withLocalFieldsUnknownToServer(serverExpense, localExpense),
          userId,
          syncStatus: 'synced',
        });
      } else if (localExpense.userId === userId && serverExpense.updatedAt === localExpense.updatedAt) {
        // 同じ版でも、内訳・店名（内訳のメモなど）を知らないコードが取り込んだ行なら、サーバーの値で直す
        const repair = sameVersionRepair(localExpense, serverExpense);
        if (repair) {
          await db.expenses.update(localExpense.id, repair);
        }
      }
      // ローカルが新しい場合はそのまま（pendingのまま）
    }

    // 月が指定されている場合、サーバーで削除されたデータをローカルからも削除
    if (month) {
      const startDate = `${month}-01`;
      const year = parseInt(month.split('-')[0] as string);
      const monthNum = parseInt(month.split('-')[1] as string);
      const nextMonth =
        monthNum === 12 ? `${year + 1}-01` : `${year}-${String(monthNum + 1).padStart(2, '0')}`;
      const endDate = `${nextMonth}-01`;

      // その月・そのユーザーのローカルデータを取得
      const localExpenses = await db.expenses
        .where('[userId+date]')
        .between([userId, startDate], [userId, endDate], true, false)
        .toArray();

      // サーバーに存在しない、かつ synced 状態のデータを削除
      for (const localExpense of localExpenses) {
        if (!serverIds.has(localExpense.id) && localExpense.syncStatus === 'synced') {
          await db.expenses.delete(localExpense.id);
        }
      }
    }
  });
}

/**
 * 指定ユーザーのIndexedDBデータを削除
 * 退会処理時に呼び出す
 * @param userId 削除対象のユーザーID
 */
export async function clearUserData(userId: string): Promise<void> {
  await db.transaction('rw', db.expenses, async () => {
    await db.expenses.where('userId').equals(userId).delete();
  });
}

/**
 * IndexedDB全体をクリア（退会時に使用）
 * 匿名ユーザーデータも含めてすべて削除
 */
export async function clearAllLocalData(): Promise<void> {
  await db.expenses.clear();
  await db.budgets.clear();
  await db.syncMeta.clear();
  await db.celebrations.clear();
}

/**
 * 指定月の祝福が表示済みかどうかを確認
 * @param month 対象月（YYYY-MM形式）
 * @param userId ユーザーID
 * @returns 表示済みならtrue
 */
export async function isCelebrationShown(
  month: string,
  userId: string = ANONYMOUS_USER_ID
): Promise<boolean> {
  const record = await db.celebrations
    .where('[userId+id]')
    .equals([userId, month])
    .first();
  return !!record;
}

/**
 * 祝福を表示済みとして記録
 * @param month 対象月（YYYY-MM形式）
 * @param userId ユーザーID
 */
export async function markCelebrationShown(
  month: string,
  userId: string = ANONYMOUS_USER_ID
): Promise<void> {
  await db.celebrations.put({
    id: month,
    userId,
    shownAt: new Date().toISOString(),
  });
}

/**
 * 指定サブ予算・指定月の支出合計を取得
 * @param subBudgetId サブ予算ID
 * @param month 対象月（YYYY-MM形式）
 * @param userId ユーザーID
 */
export async function getSubBudgetExpensesByMonth(
  subBudgetId: string,
  month: string,
  userId: string = ANONYMOUS_USER_ID
): Promise<LocalExpenseEntity[]> {
  const startDate = `${month}-01`;
  const year = parseInt(month.split('-')[0] as string);
  const monthNum = parseInt(month.split('-')[1] as string);
  const nextMonth = monthNum === 12 ? `${year + 1}-01` : `${year}-${String(monthNum + 1).padStart(2, '0')}`;
  const endDate = `${nextMonth}-01`;

  return db.expenses
    .where('[userId+date]')
    .between([userId, startDate], [userId, endDate], true, false)
    .filter((expense) => expense.subBudgetId === subBudgetId)
    .toArray();
}

/**
 * 匿名ユーザーの支出データを認証ユーザーに移行
 * セッション取得完了後に呼び出す
 *
 * @param targetUserId 移行先のユーザーID（認証済みユーザー）
 * @returns 移行した支出の件数
 */
export async function migrateAnonymousExpenses(targetUserId: string): Promise<number> {
  // 自分自身への移行は不要
  if (targetUserId === ANONYMOUS_USER_ID) {
    return 0;
  }

  const anonymousExpenses = await db.expenses
    .where('userId')
    .equals(ANONYMOUS_USER_ID)
    .toArray();

  if (anonymousExpenses.length === 0) {
    return 0;
  }

  // トランザクションで一括更新（userIdを変更し、syncStatusをpendingに）
  await db.transaction('rw', db.expenses, async () => {
    for (const expense of anonymousExpenses) {
      await db.expenses.update(expense.id, {
        userId: targetUserId,
        syncStatus: 'pending',
        updatedAt: new Date().toISOString(),
      });
    }
  });

  return anonymousExpenses.length;
}
