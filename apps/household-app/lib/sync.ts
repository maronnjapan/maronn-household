import type { ExpenseEntity } from '@maronn/domain';
import { mergeExpenses } from '@maronn/domain';
import { db, updateSyncStatus, getCurrentMonth } from './db';
import { trpc } from '../trpc/client';

// リトライ設定
const MAX_RETRY_COUNT = 3;
const INITIAL_RETRY_DELAY = 2000; // 2秒

/**
 * 指数バックオフでリトライする汎用ラッパー
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retryCount = 0
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retryCount >= MAX_RETRY_COUNT) {
      throw error;
    }

    // 指数バックオフ: 2s, 4s, 8s
    const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
    console.warn(
      `Retry ${retryCount + 1}/${MAX_RETRY_COUNT} after ${delay}ms`,
      error
    );

    await new Promise((resolve) => setTimeout(resolve, delay));
    return retryWithBackoff(fn, retryCount + 1);
  }
}

/**
 * 単一の支出をサーバーに送信（tRPC経由）
 */
async function uploadExpense(expense: ExpenseEntity): Promise<boolean> {
  try {
    const result = await retryWithBackoff(() =>
      trpc.createExpense.mutate({
        id: expense.id,
        amount: expense.amount,
        category: expense.category,
        memo: expense.memo,
        date: expense.date,
        createdAt: expense.createdAt,
        updatedAt: expense.updatedAt,
        deviceId: expense.deviceId,
      })
    );

    return result.success === true;
  } catch (error) {
    console.error('Failed to upload expense:', expense.id, error);
    return false;
  }
}

/**
 * pending 状態の支出をすべてサーバーに送信
 */
export async function syncPendingExpenses(): Promise<{
  success: number;
  failed: number;
}> {
  // オフラインの場合はスキップ
  if (!navigator.onLine) {
    console.info('Offline: skipping sync');
    return { success: 0, failed: 0 };
  }

  try {
    // pending な支出を取得
    const pendingExpenses = await db.expenses
      .where('syncStatus')
      .equals('pending')
      .toArray();

    if (pendingExpenses.length === 0) {
      console.info('No pending expenses to sync');
      return { success: 0, failed: 0 };
    }

    console.info(`Syncing ${pendingExpenses.length} pending expenses...`);

    let successCount = 0;
    let failedCount = 0;

    // 順番に送信（並列化すると競合のリスクがあるため）
    for (const expense of pendingExpenses) {
      const uploaded = await uploadExpense(expense);

      if (uploaded) {
        // 同期成功 → syncStatus を 'synced' に更新
        await updateSyncStatus(expense.id, 'synced');
        successCount++;
      } else {
        failedCount++;
      }
    }

    console.info(`Sync complete: ${successCount} success, ${failedCount} failed`);
    return { success: successCount, failed: failedCount };
  } catch (error) {
    console.error('Sync error:', error);
    return { success: 0, failed: 0 };
  }
}

/**
 * サーバーから指定月の支出を取得（tRPC経由）
 */
async function downloadExpenses(month: string): Promise<ExpenseEntity[]> {
  try {
    const result = await retryWithBackoff(() =>
      trpc.getExpenses.query({ month })
    );

    return result.expenses || [];
  } catch (error) {
    console.error('Failed to download expenses:', month, error);
    return [];
  }
}

/**
 * サーバーから支出をダウンロードしてローカルにマージ
 */
export async function syncDownloadExpenses(
  month?: string
): Promise<{
  downloaded: number;
  added: number;
  updated: number;
  conflicts: number;
}> {
  // オフラインの場合はスキップ
  if (!navigator.onLine) {
    console.info('Offline: skipping download');
    return { downloaded: 0, added: 0, updated: 0, conflicts: 0 };
  }

  try {
    const targetMonth = month || getCurrentMonth();

    // サーバーから支出を取得
    const remoteExpenses = await downloadExpenses(targetMonth);

    if (remoteExpenses.length === 0) {
      console.info('No remote expenses to sync');
      return { downloaded: 0, added: 0, updated: 0, conflicts: 0 };
    }

    console.info(`Downloaded ${remoteExpenses.length} expenses from server`);

    // ローカルの支出を取得
    const startDate = `${targetMonth}-01`;
    const year = parseInt(targetMonth.split('-')[0] as string);
    const monthNum = parseInt(targetMonth.split('-')[1] as string);
    const nextMonth =
      monthNum === 12
        ? `${year + 1}-01`
        : `${year}-${String(monthNum + 1).padStart(2, '0')}`;
    const endDate = `${nextMonth}-01`;

    const localExpenses = await db.expenses
      .where('date')
      .between(startDate, endDate, true, false)
      .toArray();

    // マージ処理
    const mergeResult = mergeExpenses(localExpenses, remoteExpenses);

    let addedCount = 0;
    let updatedCount = 0;
    let conflictsCount = 0;

    // 新しい支出を追加
    for (const expense of mergeResult.toAdd) {
      await db.expenses.put(expense);
      addedCount++;
    }

    // 既存の支出を更新
    for (const expense of mergeResult.toUpdate) {
      await db.expenses.put(expense);
      updatedCount++;
    }

    // 競合した支出を追加（両方残す）
    for (const conflict of mergeResult.conflicts) {
      // リモートの支出を新しいIDで追加
      await db.expenses.put(conflict.remote);
      conflictsCount++;
    }

    console.info(
      `Sync download complete: ${addedCount} added, ${updatedCount} updated, ${conflictsCount} conflicts`
    );

    return {
      downloaded: remoteExpenses.length,
      added: addedCount,
      updated: updatedCount,
      conflicts: conflictsCount,
    };
  } catch (error) {
    console.error('Sync download error:', error);
    return { downloaded: 0, added: 0, updated: 0, conflicts: 0 };
  }
}

/**
 * 双方向同期を実行（アップロード + ダウンロード）
 */
export async function syncBidirectional(): Promise<void> {
  if (!navigator.onLine) {
    console.info('Offline: skipping bidirectional sync');
    return;
  }

  console.info('Starting bidirectional sync...');

  // 1. pending な支出をアップロード
  await syncPendingExpenses();

  // 2. サーバーから最新データをダウンロード
  await syncDownloadExpenses();

  console.info('Bidirectional sync complete');
}

/**
 * バックグラウンド同期を開始
 * - アプリ起動時に1回実行
 * - オンライン復帰時に実行
 * - 定期的に実行（オプション）
 */
export function startBackgroundSync(): void {
  // 初回同期（双方向）
  syncBidirectional().catch(console.error);

  // オンライン復帰時の同期（双方向）
  window.addEventListener('online', () => {
    console.info('Network reconnected: starting sync...');
    syncBidirectional().catch(console.error);
  });

  // 定期同期（30秒ごと）- オンライン時のみ（双方向）
  setInterval(() => {
    if (navigator.onLine) {
      syncBidirectional().catch(console.error);
    }
  }, 30000);
}

// ブラウザ環境でモジュールロード時に自動起動
if (typeof window !== 'undefined') {
  startBackgroundSync();
}
