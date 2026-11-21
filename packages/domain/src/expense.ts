import { ulid } from 'ulidx';
import { normalizeExpenseItems, resolveExpenseCategories, type ExpenseItem } from './expense-items';

/**
 * 同期ステータス
 */
export type SyncStatus = 'pending' | 'synced' | 'conflict';

/**
 * 支出エンティティ（1回の会計）
 */
export interface ExpenseEntity {
  id: string; // ULID（ソート可能なユニークID）
  amount: number; // 支払総額（会計の合計）
  category?: string; // 会計のカテゴリー（カテゴリーのない内訳の計上先）
  memo?: string;
  date: string; // ISO 8601 (YYYY-MM-DD)
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  syncStatus: SyncStatus;
  deviceId: string; // 競合解決用
  subBudgetId?: string; // サブ予算ID（サブ予算に紐づく場合）
  /**
   * 内訳（何を買ったか）。null は内訳なし、undefined は内訳を知らないコードが書いた行（不明）。
   * サーバーへは undefined なら送らず（サーバーの内訳を変えない）、null なら内訳を消す
   */
  items?: ExpenseItem[] | null;
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
  subBudgetId?: string;
  items?: ExpenseItem[];
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
    const newDeviceId = ulid(Date.now());
    localStorage.setItem('deviceId', newDeviceId);
    return newDeviceId;
  }

  // サーバー環境やテスト環境ではランダム生成
  return ulid(Date.now());
}

/**
 * 現在の日付を YYYY-MM-DD 形式で取得（ローカルタイムゾーン基準）
 */
function getCurrentDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 新しい支出を作成
 * @param params 支出のパラメータ
 * @returns 作成された支出エンティティ
 */
export function createExpense(params: CreateExpenseParams): ExpenseEntity {
  const now = new Date().toISOString();
  // 内訳があれば、会計のカテゴリー（なければ主なカテゴリー）と内訳のカテゴリーを確定する
  const { category, items } = resolveExpenseCategories({
    amount: params.amount,
    category: params.category,
    items: normalizeExpenseItems(params.items),
  });

  return {
    id: ulid(Date.now()),
    amount: params.amount,
    category,
    memo: params.memo,
    date: params.date ?? getCurrentDate(),
    createdAt: now,
    updatedAt: now,
    syncStatus: 'pending',
    deviceId: getDeviceId(params.deviceId),
    subBudgetId: params.subBudgetId,
    items,
  };
}
