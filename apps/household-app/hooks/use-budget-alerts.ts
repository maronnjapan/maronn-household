import { trpc } from '../trpc/client';

/**
 * アラートの状態
 */
export interface AlertStatus {
  id: string;
  thresholdPercent: number;
  thresholdAmount: number | null;
  isTriggered: boolean;
  message: string;
}

/**
 * 予算アラートフック
 * 予算の残額が設定した閾値を下回った場合にアラートを返す
 */
export function useBudgetAlerts(budget: number, remaining: number) {
  const alertsQuery = trpc.listBudgetAlerts.useQuery();

  const alerts = alertsQuery.data?.alerts ?? [];
  const remainingPercent = budget > 0 ? (remaining / budget) * 100 : 100;

  // トリガーされたアラートを計算
  const triggeredAlerts: AlertStatus[] = alerts
    .filter((alert) => alert.isEnabled)
    .map((alert) => {
      let isTriggered = false;
      let message = '';

      // パーセント閾値チェック
      if (remainingPercent <= alert.thresholdPercent) {
        isTriggered = true;
        message = `予算の残りが${alert.thresholdPercent}%を切りました`;
      }

      // 金額閾値チェック（設定されている場合）
      if (alert.thresholdAmount && remaining <= alert.thresholdAmount) {
        isTriggered = true;
        message = `残り¥${alert.thresholdAmount.toLocaleString()}を切りました`;
      }

      return {
        id: alert.id,
        thresholdPercent: alert.thresholdPercent,
        thresholdAmount: alert.thresholdAmount,
        isTriggered,
        message,
      };
    })
    .filter((alert) => alert.isTriggered);

  return {
    alerts: triggeredAlerts,
    hasAlerts: triggeredAlerts.length > 0,
    isLoading: alertsQuery.isLoading,
  };
}

/**
 * 予算アラート設定管理フック
 */
export function useBudgetAlertSettings() {
  const utils = trpc.useUtils();
  const alertsQuery = trpc.listBudgetAlerts.useQuery();
  const createMutation = trpc.createBudgetAlert.useMutation({
    onSuccess: () => {
      utils.listBudgetAlerts.invalidate();
    },
  });
  const updateMutation = trpc.updateBudgetAlert.useMutation({
    onSuccess: () => {
      utils.listBudgetAlerts.invalidate();
    },
  });
  const deleteMutation = trpc.deleteBudgetAlert.useMutation({
    onSuccess: () => {
      utils.listBudgetAlerts.invalidate();
    },
  });

  return {
    alerts: alertsQuery.data?.alerts ?? [],
    isLoading: alertsQuery.isLoading,
    createAlert: createMutation.mutateAsync,
    updateAlert: updateMutation.mutateAsync,
    deleteAlert: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
