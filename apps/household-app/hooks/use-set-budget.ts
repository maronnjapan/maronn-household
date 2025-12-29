import { useCallback } from 'react';
import { trpc } from '../trpc/client';
import { setBudget } from '../lib/db';
import { getCurrentMonth } from '../lib/db';

export interface UseSetBudgetResult {
  updateBudget: (month: string, amount: number) => Promise<void>;
  isUpdating: boolean;
}

/**
 * 予算を設定するフック
 * サーバーに保存し、成功したらIndexedDBにも保存する
 */
export function useSetBudget(): UseSetBudgetResult {
  const mutation = trpc.updateBudget.useMutation();

  const handleUpdateBudget = useCallback(
    async (month: string, amount: number): Promise<void> => {
      // 1. サーバーに保存
      await mutation.mutateAsync({ month, amount });

      // 2. サーバー保存が成功したらIndexedDBにも保存
      await setBudget(month, amount);
    },
    [mutation]
  );

  return {
    updateBudget: handleUpdateBudget,
    isUpdating: mutation.isPending,
  };
}

/**
 * 予算を取得するフック
 */
export function useGetBudget(month: string = getCurrentMonth()) {
  const query = trpc.getBudget.useQuery({ month });

  return {
    budget: query.data?.budget,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
