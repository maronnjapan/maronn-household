/**
 * サブスクリプション判定ユーティリティ
 * フリーミアムモデルの基盤
 */

import type { SubscriptionPlan, SubscriptionStatus } from '../database/drizzle/schema/household';

/**
 * サブスクリプション情報
 */
export interface Subscription {
  id: string;
  userId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  startedAt: string;
  expiresAt: string | null;
  canceledAt: string | null;
}

/**
 * プレミアム機能の種類
 */
export type PremiumFeature =
  | 'category_analysis'      // カテゴリ別分析・グラフ
  | 'recurring_expenses'     // 定期支出の登録
  | 'budget_alerts'          // 予算アラート
  | 'csv_export'             // CSVエクスポート（無制限）
  | 'multiple_budgets'       // 複数予算管理（将来）
  | 'unlimited_webhooks';    // Webhook無制限（将来）

/**
 * 無料プランの制限
 */
export const FREE_PLAN_LIMITS = {
  // カテゴリ分析: 過去1ヶ月のみ
  categoryAnalysisMonths: 1,
  // 定期支出: 3件まで
  recurringExpenses: 3,
  // 予算アラート: 1件まで
  budgetAlerts: 1,
  // CSVエクスポート: 過去3ヶ月まで
  csvExportMonths: 3,
  // Webhook: 2件まで（既存の5件を無料で維持する場合は別途調整）
  webhooks: 5,
} as const;

/**
 * プレミアムプランの特典
 */
export const PREMIUM_PLAN_BENEFITS = {
  // カテゴリ分析: 全期間
  categoryAnalysisMonths: Infinity,
  // 定期支出: 無制限
  recurringExpenses: Infinity,
  // 予算アラート: 無制限
  budgetAlerts: Infinity,
  // CSVエクスポート: 全期間
  csvExportMonths: Infinity,
  // Webhook: 無制限
  webhooks: Infinity,
} as const;

/**
 * プレミアムプランの価格（円/月）
 */
export const PREMIUM_PRICE_MONTHLY = 480;

/**
 * プレミアムプランの年額価格（円/年）- 2ヶ月分お得
 */
export const PREMIUM_PRICE_YEARLY = 4800;

/**
 * サブスクリプションがアクティブかどうかを判定
 */
export function isSubscriptionActive(subscription: Subscription | null): boolean {
  if (!subscription) {
    return false;
  }

  if (subscription.status !== 'active') {
    return false;
  }

  // 有効期限がある場合はチェック
  if (subscription.expiresAt) {
    const now = new Date();
    const expiresAt = new Date(subscription.expiresAt);
    return now < expiresAt;
  }

  return true;
}

/**
 * ユーザーがプレミアムプランかどうかを判定
 */
export function isPremiumUser(subscription: Subscription | null): boolean {
  if (!subscription) {
    return false;
  }

  return subscription.plan === 'premium' && isSubscriptionActive(subscription);
}

/**
 * 特定のプレミアム機能が利用可能かどうかを判定
 * 無料プランでも制限付きで利用可能な機能がある
 */
export function canUseFeature(
  feature: PremiumFeature,
  subscription: Subscription | null,
  currentUsage?: number
): { allowed: boolean; limit: number | null; remaining: number | null } {
  const isPremium = isPremiumUser(subscription);

  // プレミアムユーザーは全機能無制限
  if (isPremium) {
    return { allowed: true, limit: null, remaining: null };
  }

  // 無料プランの制限をチェック
  switch (feature) {
    case 'category_analysis':
      return {
        allowed: true,
        limit: FREE_PLAN_LIMITS.categoryAnalysisMonths,
        remaining: null, // 月数制限は別途チェック
      };

    case 'recurring_expenses': {
      const limit = FREE_PLAN_LIMITS.recurringExpenses;
      const used = currentUsage ?? 0;
      return {
        allowed: used < limit,
        limit,
        remaining: Math.max(0, limit - used),
      };
    }

    case 'budget_alerts': {
      const limit = FREE_PLAN_LIMITS.budgetAlerts;
      const used = currentUsage ?? 0;
      return {
        allowed: used < limit,
        limit,
        remaining: Math.max(0, limit - used),
      };
    }

    case 'csv_export':
      return {
        allowed: true,
        limit: FREE_PLAN_LIMITS.csvExportMonths,
        remaining: null,
      };

    case 'multiple_budgets':
      // 将来の機能: プレミアム限定
      return { allowed: false, limit: 0, remaining: 0 };

    case 'unlimited_webhooks': {
      const limit = FREE_PLAN_LIMITS.webhooks;
      const used = currentUsage ?? 0;
      return {
        allowed: used < limit,
        limit,
        remaining: Math.max(0, limit - used),
      };
    }

    default:
      return { allowed: false, limit: 0, remaining: 0 };
  }
}

/**
 * 機能の制限に達しているかどうかを判定
 */
export function isFeatureLimitReached(
  feature: PremiumFeature,
  subscription: Subscription | null,
  currentUsage: number
): boolean {
  const result = canUseFeature(feature, subscription, currentUsage);
  return !result.allowed;
}

/**
 * プランの制限値を取得
 */
export function getPlanLimits(subscription: Subscription | null) {
  if (isPremiumUser(subscription)) {
    return PREMIUM_PLAN_BENEFITS;
  }
  return FREE_PLAN_LIMITS;
}
