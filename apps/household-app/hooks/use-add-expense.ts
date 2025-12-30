import { useCallback } from 'react';
import { createExpense, type CreateExpenseParams } from '@maronn/domain';
import { addExpense } from '../lib/db';
import { syncPendingExpenses } from '../lib/sync';
import { trpc } from '../trpc/client';

export interface UseAddExpenseResult {
  addExpense: (params: CreateExpenseParams) => Promise<string>;
  isAdding: boolean;
}

/**
 * 支出を追加するフック
 * ローカル（IndexedDB）に即座に保存し、UIを即座に更新（< 50ms）
 * サーバー同期はバックグラウンドで行う
 */
export function useAddExpense(): UseAddExpenseResult {
  const utils = trpc.useUtils();

  const handleAddExpense = useCallback(
    async (params: CreateExpenseParams): Promise<string> => {
      // 1. 支出エンティティを作成（syncStatus: 'pending'）
      const expense = createExpense(params);

      // 2. IndexedDB に即座に保存（< 50ms）
      const id = await addExpense(expense);

      // 3. useLiveQuery が自動検知して UI が即座に更新される

      // 4. バックグラウンド同期（UIをブロックしない）
      syncPendingExpenses().catch(console.error);

      // 5. tRPCキャッシュを無効化（他ページへ遷移時に最新データを取得）
      await utils.getExpenses.invalidate();

      return id;
    },
    [utils]
  );

  return {
    addExpense: handleAddExpense,
    isAdding: false, // 将来的にローディング状態を管理
  };
}
