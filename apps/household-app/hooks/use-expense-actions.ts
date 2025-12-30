import { useCallback } from 'react';
import { updateExpense, deleteExpense } from '../lib/db';
import { vanillaTrpc } from '../trpc/client';
import { getDeviceId } from '../lib/device';

export interface UpdateExpenseParams {
  amount?: number;
  memo?: string;
  category?: string;
  date?: string;
}

export interface UseExpenseActionsResult {
  handleUpdateExpense: (id: string, params: UpdateExpenseParams) => Promise<boolean>;
  handleDeleteExpense: (id: string) => Promise<boolean>;
}

/**
 * サーバーに更新を同期（バックグラウンド）
 */
async function syncUpdateToServer(
  id: string,
  params: UpdateExpenseParams,
  updatedAt: string,
  deviceId: string
): Promise<void> {
  if (!navigator.onLine) {
    console.info('Offline: update will sync later');
    return;
  }

  try {
    await vanillaTrpc.updateExpense.mutate({
      id,
      amount: params.amount,
      category: params.category,
      memo: params.memo,
      date: params.date,
      updatedAt,
      deviceId,
    });
  } catch (error) {
    console.error('Failed to sync update to server:', error);
  }
}

/**
 * サーバーから削除を同期（バックグラウンド）
 */
async function syncDeleteToServer(id: string): Promise<void> {
  if (!navigator.onLine) {
    console.info('Offline: delete will sync later');
    return;
  }

  try {
    await vanillaTrpc.deleteExpense.mutate({ id });
  } catch (error) {
    console.error('Failed to sync delete to server:', error);
  }
}

/**
 * 支出の編集・削除アクションを提供するフック
 * ローカルファースト: 即座にIndexedDBを更新し、バックグラウンドでサーバーに同期
 */
export function useExpenseActions(): UseExpenseActionsResult {
  const handleUpdateExpense = useCallback(
    async (id: string, params: UpdateExpenseParams): Promise<boolean> => {
      // 1. IndexedDB を即座に更新（< 50ms）
      const updated = await updateExpense(id, params);

      if (!updated) {
        return false;
      }

      // 2. バックグラウンドでサーバーに同期（UIをブロックしない）
      const deviceId = getDeviceId();
      syncUpdateToServer(id, params, updated.updatedAt, deviceId).catch(console.error);

      return true;
    },
    []
  );

  const handleDeleteExpense = useCallback(async (id: string): Promise<boolean> => {
    // 1. IndexedDB から即座に削除（< 50ms）
    const deleted = await deleteExpense(id);

    if (!deleted) {
      return false;
    }

    // 2. バックグラウンドでサーバーに同期（UIをブロックしない）
    syncDeleteToServer(id).catch(console.error);

    return true;
  }, []);

  return {
    handleUpdateExpense,
    handleDeleteExpense,
  };
}
