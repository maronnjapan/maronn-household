import { useCallback } from 'react';
import { trpc } from '../trpc/client';
import { getCurrentMonth } from '../lib/db';

export interface UseSetBudgetResult {
  updateBudget: (month: string, amount: number) => Promise<void>;
  isUpdating: boolean;
}

/**
 * 予算を設定するフック
 * サーバーのみに保存（IndexedDBとの二重管理は行わない）
 */
export function useSetBudget(): UseSetBudgetResult {
  const mutation = trpc.updateBudget.useMutation();

  const handleUpdateBudget = useCallback(
    async (month: string, amount: number): Promise<void> => {
      await mutation.mutateAsync({ month, amount });
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
