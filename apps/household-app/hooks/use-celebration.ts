import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  getPreviousMonth,
  isFirstDayOfMonth,
  shouldShowCelebration,
} from '@maronn/domain';
import {
  getExpensesByMonth,
  isCelebrationShown,
  markCelebrationShown,
} from '../lib/db';
import { DEFAULT_BUDGET_AMOUNT } from '../lib/const';
import { trpc } from '../trpc/client';
import { useAuth } from './use-auth';

export interface CelebrationResult {
  /** 祝福を表示すべきかどうか */
  showCelebration: boolean;
  /** 前月の予算 */
  previousBudget: number;
  /** 前月の支出合計 */
  previousSpent: number;
  /** 前月の残額（予算 - 支出） */
  previousRemaining: number;
  /** 対象月（予算内で終了した前月） */
  targetMonth: string;
  /** 祝福を閉じる（表示済みとして記録） */
  dismissCelebration: () => Promise<void>;
  /** ロード中かどうか */
  isLoading: boolean;
}

/**
 * 月初の祝福表示を管理するフック
 *
 * 以下の条件を満たす場合に祝福を表示:
 * - 今日が月初日（1日）である
 * - 前月の支出が予算内に収まっている
 * - まだ今月の祝福を表示していない（IndexedDBに記録がない）
 */
export function useCelebration(): CelebrationResult {
  const { userId } = useAuth();
  const [isDismissed, setIsDismissed] = useState(false);

  // 今日が月初日かどうか
  const isFirstDay = isFirstDayOfMonth();

  // 前月のYYYY-MM
  const previousMonth = getPreviousMonth();

  // 前月の予算をサーバーから取得
  const budgetQuery = trpc.getBudget.useQuery(
    { month: previousMonth },
    {
      enabled: isFirstDay, // 月初日のみ実行
      retry: 1,
      staleTime: 30 * 1000,
    }
  );

  // IndexedDBから前月の支出と祝福表示済み状態を取得
  const localData = useLiveQuery(
    async () => {
      // 月初日でなければ何も取得しない
      if (!isFirstDay) {
        return null;
      }

      const [expenses, alreadyShown] = await Promise.all([
        getExpensesByMonth(previousMonth, userId),
        isCelebrationShown(previousMonth, userId),
      ]);

      const spent = expenses.reduce((sum, e) => sum + e.amount, 0);

      return {
        expenses,
        spent,
        alreadyShown,
      };
    },
    [previousMonth, userId, isFirstDay]
  );

  // 祝福を閉じる（表示済みとして記録）
  const dismissCelebration = async () => {
    await markCelebrationShown(previousMonth, userId);
    setIsDismissed(true);
  };

  // ローディング中
  if (!isFirstDay || !localData) {
    return {
      showCelebration: false,
      previousBudget: 0,
      previousSpent: 0,
      previousRemaining: 0,
      targetMonth: previousMonth,
      dismissCelebration,
      isLoading: isFirstDay && !localData,
    };
  }

  // 予算額を決定（サーバーから取得できない場合はデフォルト値）
  const previousBudget = budgetQuery.data?.budget?.amount ?? DEFAULT_BUDGET_AMOUNT;
  const previousSpent = localData.spent;
  const previousRemaining = previousBudget - previousSpent;

  // 祝福を表示すべきかどうかを判定
  const shouldShow =
    !isDismissed &&
    !localData.alreadyShown &&
    shouldShowCelebration(previousBudget, localData.expenses);

  return {
    showCelebration: shouldShow,
    previousBudget,
    previousSpent,
    previousRemaining,
    targetMonth: previousMonth,
    dismissCelebration,
    isLoading: false,
  };
}
