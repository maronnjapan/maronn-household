import { useCallback } from 'react';
import { createExpense, type CreateExpenseParams } from '@maronn/domain';
import { addExpense } from '../lib/db';
import { syncPendingExpenses } from '../lib/sync';
import { trpc } from '../trpc/client';
import { useAuth } from './use-auth';

export interface UseAddExpenseResult {
  addExpense: (params: CreateExpenseParams) => Promise<string>;
  isAdding: boolean;
}

/**
 * 支出を追加するフック
 * ローカル（IndexedDB）に即座に保存し、UIを即座に更新（< 50ms）
 * サーバー同期はバックグラウンドで行う（認証時のみ）
 */
export function useAddExpense(): UseAddExpenseResult {
  const utils = trpc.useUtils();
  const { isAuthenticated, userId } = useAuth();

  const handleAddExpense = useCallback(
    async (params: CreateExpenseParams): Promise<string> => {
      // 1. 支出エンティティを作成（syncStatus: 'pending'）
      const expense = createExpense(params);

      // 2. IndexedDB に即座に保存（ユーザーIDを付与）
      const id = await addExpense(expense, userId);

      // 3. useLiveQuery が自動検知して UI が即座に更新される

      // 4. 認証時のみバックグラウンド同期を実行（UIをブロックしない）
      if (isAuthenticated) {
        syncPendingExpenses(userId).catch(console.error);

        // 5. tRPCキャッシュを無効化（他ページへ遷移時に最新データを取得）
        await utils.getExpenses.invalidate();
      }

      return id;
    },
    [utils, isAuthenticated, userId]
  );

  return {
    addExpense: handleAddExpense,
    isAdding: false, // 将来的にローディング状態を管理
  };
}
