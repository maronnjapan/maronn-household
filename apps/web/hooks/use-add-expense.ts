import { useCallback } from 'react';
import { createExpense, type CreateExpenseParams } from '@maronn/domain';
import { addExpense } from '#lib/db';

export interface UseAddExpenseResult {
  addExpense: (params: CreateExpenseParams) => Promise<string>;
  isAdding: boolean;
}

/**
 * 支出を追加するフック
 * ローカル（IndexedDB）に即座に保存し、UIを即座に更新（< 50ms）
 * サーバー同期はバックグラウンドで行う（将来実装）
 */
export function useAddExpense(): UseAddExpenseResult {
  const handleAddExpense = useCallback(
    async (params: CreateExpenseParams): Promise<string> => {
      // 1. 支出エンティティを作成（syncStatus: 'pending'）
      const expense = createExpense(params);

      // 2. IndexedDB に即座に保存（< 50ms）
      const id = await addExpense(expense);

      // 3. useLiveQuery が自動検知して UI が即座に更新される

      // 4. バックグラウンド同期（将来実装）
      // syncToServer(expense).catch(console.error);

      return id;
    },
    []
  );

  return {
    addExpense: handleAddExpense,
    isAdding: false, // 将来的にローディング状態を管理
  };
}
