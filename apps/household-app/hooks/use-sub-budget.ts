import { useCallback } from 'react';
import { trpc } from '../trpc/client';
import { getCurrentMonth } from '../lib/db';
import { useAuth } from './use-auth';

export interface SubBudget {
  id: string;
  userId: string;
  name: string;
  amount: number;
  startMonth: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubBudgetDetail {
  subBudget: SubBudget;
  monthlyAmount: number;
  carryover: number;
  available: number;
  spent: number;
  remaining: number;
}

/**
 * サブ予算一覧を取得するフック
 */
export function useSubBudgets() {
  const { isAuthenticated } = useAuth();
  const query = trpc.getSubBudgets.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 30 * 1000,
  });

  return {
    subBudgets: (query.data?.subBudgets ?? []) as SubBudget[],
    isLoading: isAuthenticated ? query.isLoading : false,
    error: query.error,
    refetch: query.refetch,
    isAuthenticated,
  };
}

/**
 * サブ予算詳細（繰り越し計算込み）を取得するフック
 */
export function useSubBudgetDetail(subBudgetId: string, month: string = getCurrentMonth()) {
  const { isAuthenticated } = useAuth();
  const query = trpc.getSubBudgetDetail.useQuery(
    { id: subBudgetId, month },
    {
      enabled: isAuthenticated && !!subBudgetId,
      staleTime: 30 * 1000,
      refetchOnWindowFocus: true,
    }
  );

  return {
    detail: query.data as SubBudgetDetail | undefined,
    isLoading: isAuthenticated ? query.isLoading : false,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * サブ予算を作成するフック
 */
export function useCreateSubBudget() {
  const utils = trpc.useUtils();
  const { isAuthenticated } = useAuth();
  const mutation = trpc.createSubBudget.useMutation({
    onSuccess: () => {
      utils.getSubBudgets.invalidate();
    },
  });

  const createSubBudget = useCallback(
    async (name: string, amount: number, startMonth: string = getCurrentMonth()) => {
      if (!isAuthenticated) {
        console.warn('Cannot create sub-budget: not authenticated');
        return;
      }
      return mutation.mutateAsync({ name, amount, startMonth });
    },
    [mutation, isAuthenticated]
  );

  return {
    createSubBudget,
    isCreating: mutation.isPending,
    isAuthenticated,
  };
}

/**
 * サブ予算を更新するフック
 */
export function useUpdateSubBudget() {
  const utils = trpc.useUtils();
  const { isAuthenticated } = useAuth();
  const mutation = trpc.updateSubBudget.useMutation({
    onSuccess: (_data, variables) => {
      utils.getSubBudgets.invalidate();
      utils.getSubBudgetDetail.invalidate({ id: variables.id });
    },
  });

  const updateSubBudget = useCallback(
    async (id: string, params: { name?: string; amount?: number }, month: string = getCurrentMonth()) => {
      if (!isAuthenticated) {
        console.warn('Cannot update sub-budget: not authenticated');
        return;
      }
      return mutation.mutateAsync({ id, ...params, month });
    },
    [mutation, isAuthenticated]
  );

  return {
    updateSubBudget,
    isUpdating: mutation.isPending,
    isAuthenticated,
  };
}

/**
 * サブ予算を削除するフック
 */
export function useDeleteSubBudget() {
  const utils = trpc.useUtils();
  const { isAuthenticated } = useAuth();
  const mutation = trpc.deleteSubBudget.useMutation({
    onSuccess: () => {
      utils.getSubBudgets.invalidate();
    },
  });

  const deleteSubBudget = useCallback(
    async (id: string) => {
      if (!isAuthenticated) {
        console.warn('Cannot delete sub-budget: not authenticated');
        return;
      }
      return mutation.mutateAsync({ id });
    },
    [mutation, isAuthenticated]
  );

  return {
    deleteSubBudget,
    isDeleting: mutation.isPending,
    isAuthenticated,
  };
}
