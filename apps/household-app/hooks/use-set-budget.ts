import { useCallback } from 'react';
import { trpc } from '../trpc/client';
import { getCurrentMonth } from '../lib/db';
import { useAuth } from './use-auth';

export interface UseSetBudgetResult {
  updateBudget: (month: string, amount: number) => Promise<void>;
  isUpdating: boolean;
  isAuthenticated: boolean;
}

/**
 * 予算を設定するフック
 * サーバーのみに保存（IndexedDBとの二重管理は行わない）
 * 認証時のみ更新可能
 */
export function useSetBudget(): UseSetBudgetResult {
  const utils = trpc.useUtils();
  const { isAuthenticated } = useAuth();
  const mutation = trpc.updateBudget.useMutation({
    onSuccess: (_data, variables) => {
      // 予算キャッシュを無効化して最新データを再取得
      utils.getBudget.invalidate({ month: variables.month });
    },
  });

  const handleUpdateBudget = useCallback(
    async (month: string, amount: number): Promise<void> => {
      // 認証していない場合は何もしない
      if (!isAuthenticated) {
        console.warn('Cannot update budget: not authenticated');
        return;
      }
      await mutation.mutateAsync({ month, amount });
    },
    [mutation, isAuthenticated]
  );

  return {
    updateBudget: handleUpdateBudget,
    isUpdating: mutation.isPending,
    isAuthenticated,
  };
}

/**
 * 予算を取得するフック
 * 認証時のみサーバーから取得、未認証時はデフォルト値を返す
 */
export function useGetBudget(month: string = getCurrentMonth()) {
  const { isAuthenticated } = useAuth();
  const query = trpc.getBudget.useQuery(
    { month },
    {
      enabled: isAuthenticated, // 認証時のみ実行
    }
  );

  return {
    budget: query.data?.budget,
    isLoading: isAuthenticated ? query.isLoading : false,
    error: query.error,
    refetch: query.refetch,
    isAuthenticated,
  };
}
