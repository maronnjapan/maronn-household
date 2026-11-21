import { useCallback } from 'react';
import { updateExpense, deleteExpense, ANONYMOUS_USER_ID, type ExpenseUpdates } from '../lib/db';
import { syncPendingExpenses } from '../lib/sync';
import { trpc, vanillaTrpc } from '../trpc/client';
import { useAuth } from './use-auth';

/** 支出の更新内容（items は undefined なら変えず、null なら内訳を消し、配列なら置き換える） */
export type UpdateExpenseParams = ExpenseUpdates;

export interface UseExpenseActionsResult {
  handleUpdateExpense: (id: string, params: UpdateExpenseParams) => Promise<boolean>;
  handleDeleteExpense: (id: string) => Promise<boolean>;
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
 * ローカルファースト: 即座にIndexedDBを更新し、バックグラウンドでサーバーに同期（認証時のみ）
 */
export function useExpenseActions(): UseExpenseActionsResult {
  const utils = trpc.useUtils();
  const { isAuthenticated, userId } = useAuth();

  const handleUpdateExpense = useCallback(
    async (id: string, params: UpdateExpenseParams): Promise<boolean> => {
      // 1. IndexedDB を即座に更新（< 50ms）
      const updated = await updateExpense(id, params, userId);

      if (!updated) {
        return false;
      }

      // 2. 認証時のみバックグラウンドでサーバーに同期（UIをブロックしない）
      // 記録の同期と同じく、確定した全項目（カテゴリーを確定した内訳、消したメモなど）を送る。
      // 渡された差分だけを送ると、サーバーとローカルが同じ版のまま食い違い、以後の同期でも直らないため
      if (isAuthenticated) {
        syncPendingExpenses(userId).catch(console.error);

        // 3. tRPCキャッシュを無効化（他ページへ遷移時に最新データを取得）
        await utils.getExpenses.invalidate();
      }

      return true;
    },
    [utils, isAuthenticated, userId]
  );

  const handleDeleteExpense = useCallback(
    async (id: string): Promise<boolean> => {
      // ログインを確認できない間（オフラインで最後のユーザーのデータを表示している間）は削除しない。
      // 削除はサーバーに送れず、オンラインに戻ったときの同期で支出が復活してしまうため
      if (!isAuthenticated && userId !== ANONYMOUS_USER_ID) {
        window.alert('オフラインの間は支出を削除できません。オンラインになってからもう一度お試しください。');
        return false;
      }

      // 1. IndexedDB から即座に削除（< 50ms）
      const deleted = await deleteExpense(id, userId);

      if (!deleted) {
        return false;
      }

      // 2. 認証時のみバックグラウンドでサーバーに同期（UIをブロックしない）
      if (isAuthenticated) {
        syncDeleteToServer(id).catch(console.error);

        // 3. tRPCキャッシュを無効化（他ページへ遷移時に最新データを取得）
        await utils.getExpenses.invalidate();
      }

      return true;
    },
    [utils, isAuthenticated, userId]
  );

  return {
    handleUpdateExpense,
    handleDeleteExpense,
  };
}
