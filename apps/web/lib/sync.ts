import type { ExpenseEntity } from '@maronn/domain';
import { db, updateSyncStatus } from './db';

// API エンドポイント
// 開発時は Vite dev server のプロキシを想定、本番は環境変数から取得
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// リトライ設定
const MAX_RETRY_COUNT = 3;
const INITIAL_RETRY_DELAY = 2000; // 2秒

/**
 * 指数バックオフでリトライする fetch ラッパー
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryCount = 0
): Promise<Response> {
  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response;
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
    return fetchWithRetry(url, options, retryCount + 1);
  }
}

/**
 * 単一の支出をサーバーに送信
 */
async function uploadExpense(expense: ExpenseEntity): Promise<boolean> {
  try {
    const response = await fetchWithRetry(
      `${API_BASE_URL}/expenses`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: expense.id,
          amount: expense.amount,
          category: expense.category,
          memo: expense.memo,
          date: expense.date,
          createdAt: expense.createdAt,
          updatedAt: expense.updatedAt,
          deviceId: expense.deviceId,
        }),
      }
    );

    const data = await response.json();
    return data.success === true;
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
 * バックグラウンド同期を開始
 * - アプリ起動時に1回実行
 * - オンライン復帰時に実行
 * - 定期的に実行（オプション）
 */
export function startBackgroundSync(): void {
  // 初回同期
  syncPendingExpenses().catch(console.error);

  // オンライン復帰時の同期
  window.addEventListener('online', () => {
    console.info('Network reconnected: starting sync...');
    syncPendingExpenses().catch(console.error);
  });

  // 定期同期（30秒ごと）- オンライン時のみ
  setInterval(() => {
    if (navigator.onLine) {
      syncPendingExpenses().catch(console.error);
    }
  }, 30000);
}

// ブラウザ環境でモジュールロード時に自動起動
if (typeof window !== 'undefined') {
  startBackgroundSync();
}
