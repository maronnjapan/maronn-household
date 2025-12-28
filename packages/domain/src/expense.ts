import { ulid } from 'ulid';

/**
 * 同期ステータス
 */
export type SyncStatus = 'pending' | 'synced' | 'conflict';

/**
 * 支出エンティティ
 */
export interface ExpenseEntity {
  id: string; // ULID（ソート可能なユニークID）
  amount: number;
  category?: string;
  memo?: string;
  date: string; // ISO 8601 (YYYY-MM-DD)
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  syncStatus: SyncStatus;
  deviceId: string; // 競合解決用
}

/**
 * 支出作成時のパラメータ
 */
export interface CreateExpenseParams {
  amount: number;
  category?: string;
  memo?: string;
  date?: string;
  deviceId?: string;
}

/**
 * デフォルトのデバイスIDを生成または取得
 */
function getDeviceId(providedDeviceId?: string): string {
  if (providedDeviceId) {
    return providedDeviceId;
  }

  // ブラウザ環境では localStorage から取得・生成
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('deviceId');
    if (stored) {
      return stored;
    }
    const newDeviceId = ulid();
    localStorage.setItem('deviceId', newDeviceId);
    return newDeviceId;
  }

  // サーバー環境やテスト環境ではランダム生成
  return ulid();
}

/**
 * 現在の日付を YYYY-MM-DD 形式で取得
 */
function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0] as string;
}

/**
 * 新しい支出を作成
 * @param params 支出のパラメータ
 * @returns 作成された支出エンティティ
 */
export function createExpense(params: CreateExpenseParams): ExpenseEntity {
  const now = new Date().toISOString();

  return {
    id: ulid(),
    amount: params.amount,
    category: params.category,
    memo: params.memo,
    date: params.date ?? getCurrentDate(),
    createdAt: now,
    updatedAt: now,
    syncStatus: 'pending',
    deviceId: getDeviceId(params.deviceId),
  };
}
