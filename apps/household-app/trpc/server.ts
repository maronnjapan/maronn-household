import type { dbD1 } from '../database/drizzle/db';
import { initTRPC, TRPCError } from '@trpc/server';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import {
  expenses,
  budgets,
  apiTokens,
  apiUsage,
  webhooks,
  userSubscriptions,
  recurringExpenses,
  budgetAlerts,
} from '../database/drizzle/schema/household';
import {
  isPremiumUser,
  canUseFeature,
  FREE_PLAN_LIMITS,
  type Subscription,
} from '../lib/subscription';
import { z } from 'zod';
import { generateSecureToken, hashToken } from '../lib/api-token';
import {
  encryptWebhookSecret,
  decryptWebhookSecret,
} from '../lib/webhook-secret';
import { createWebhookSignature } from '../lib/webhook-signature';
import { ulid } from 'ulidx';
import type { Session, User } from 'better-auth/types';

/**
 * Cloudflare Workers環境変数の型定義
 */
interface Env {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  WEBHOOK_SECRET_KEY: string;
  // AWS SES設定（将来の切り替え用に残す）
  // AWS_ACCESS_KEY_ID?: string;
  // AWS_SECRET_ACCESS_KEY?: string;
  // AWS_REGION?: string;
}

/**
 * tRPCコンテキスト型定義
 * セッション情報とユーザー情報を含む
 */
interface Context {
  db: ReturnType<typeof dbD1>;
  env?: Env;
  session?: Session | null;
  user?: User | null;
  req?: Request;
  resHeaders?: Headers;
}

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.context<Context>().create();

/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * 認証保護されたプロシージャ
 * ログインしているユーザーのみアクセス可能
 * ユーザーIDの存在も保証する
 */
export const protectedProcedure = t.procedure.use(async (opts) => {
  const { ctx } = opts;

  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to access this resource',
    });
  }

  // ユーザーIDの存在を確認（実際のプロシージャで直接使用されるため）
  if (!ctx.user.id) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'User ID is missing from the authenticated user object',
    });
  }

  return opts.next({
    ctx: {
      ...ctx,
      user: ctx.user, // 型安全性のため（idの存在も保証済み）
    },
  });
});

// 入力バリデーション用のスキーマ
const expenseInputSchema = z.object({
  id: z.string(),
  amount: z.number(),
  category: z.string().optional(),
  memo: z.string().optional(),
  date: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deviceId: z.string(),
});

const getExpensesInputSchema = z.object({
  month: z.string().optional(),
});

const updateExpenseInputSchema = z.object({
  id: z.string(),
  amount: z.number().optional(),
  category: z.string().optional(),
  memo: z.string().optional(),
  date: z.string().optional(),
  updatedAt: z.string(),
  deviceId: z.string(),
});

const deleteExpenseInputSchema = z.object({
  id: z.string(),
});

const budgetInputSchema = z.object({
  month: z.string(),
});

const updateBudgetInputSchema = z.object({
  month: z.string(),
  amount: z.number(),
});

const issueApiTokenInputSchema = z.object({
  name: z.string().optional(),
});

const revokeApiTokenInputSchema = z.object({
  tokenHash: z.string(),
});

const createWebhookInputSchema = z.object({
  url: z.string().url(),
  secret: z.string().optional(),
});

const deleteWebhookInputSchema = z.object({
  id: z.string(),
});

// 定期支出入力スキーマ
const createRecurringExpenseInputSchema = z.object({
  amount: z.number().positive(),
  category: z.string().optional(),
  memo: z.string().optional(),
  dayOfMonth: z.number().min(1).max(31),
});

const updateRecurringExpenseInputSchema = z.object({
  id: z.string(),
  amount: z.number().positive().optional(),
  category: z.string().optional(),
  memo: z.string().optional(),
  dayOfMonth: z.number().min(1).max(31).optional(),
  isActive: z.boolean().optional(),
});

const deleteRecurringExpenseInputSchema = z.object({
  id: z.string(),
});

// 予算アラート入力スキーマ
const createBudgetAlertInputSchema = z.object({
  thresholdPercent: z.number().min(1).max(100),
  thresholdAmount: z.number().positive().optional(),
});

const updateBudgetAlertInputSchema = z.object({
  id: z.string(),
  thresholdPercent: z.number().min(1).max(100).optional(),
  thresholdAmount: z.number().positive().optional(),
  isEnabled: z.boolean().optional(),
});

const deleteBudgetAlertInputSchema = z.object({
  id: z.string(),
});

// カテゴリ分析入力スキーマ
const getCategoryAnalysisInputSchema = z.object({
  month: z.string().optional(), // YYYY-MM形式、省略時は今月
  months: z.number().min(1).max(12).optional(), // 過去何ヶ月分を取得（デフォルト1）
});

async function deliverExpenseWebhooks(params: {
  database: ReturnType<typeof drizzle>;
  env?: Env;
  userId: string;
  expense: {
    id: string;
    amount: number;
    category?: string;
    memo?: string;
    date: string;
    createdAt: string;
    updatedAt: string;
    deviceId: string;
  };
  event: 'expense.created' | 'expense.updated';
}) {
  const { database, env, userId, expense, event } = params;
  const targets = await database
    .select()
    .from(webhooks)
    .where(eq(webhooks.userId, userId))
    .all();

  if (targets.length === 0) {
    return;
  }

  const payload = JSON.stringify({
    event,
    occurredAt: new Date().toISOString(),
    userId,
    expense: {
      id: expense.id,
      amount: expense.amount,
      category: expense.category ?? null,
      memo: expense.memo ?? null,
      date: expense.date,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
      deviceId: expense.deviceId,
    },
  });

  await Promise.allSettled(
    targets.map(async (target) => {
      const headers = new Headers({
        'Content-Type': 'application/json',
        'X-Household-Webhook-Event': event,
        'X-Household-Webhook-Id': target.id,
      });

      if (target.secretEncrypted && target.secretIv) {
        if (!env?.WEBHOOK_SECRET_KEY) {
          console.error('[Webhook] Missing WEBHOOK_SECRET_KEY for signing');
          return;
        }
        const secret = await decryptWebhookSecret(
          target.secretEncrypted,
          target.secretIv,
          env.WEBHOOK_SECRET_KEY
        );
        const signature = await createWebhookSignature(secret, payload);
        headers.set('X-Household-Webhook-Signature', signature);
      }

      const response = await fetch(target.url, {
        method: 'POST',
        headers,
        body: payload,
      });

      if (!response.ok) {
        console.error('[Webhook] Delivery failed', {
          url: target.url,
          status: response.status,
          statusText: response.statusText,
        });
      }
    })
  );
}

export const appRouter = router({
  // デモエンドポイント（認証不要）
  demo: publicProcedure.query(async () => {
    return { demo: true, message: 'Household app tRPC is working!' };
  }),

  // セッション情報取得（認証不要）
  getSession: publicProcedure.query(async (opts) => {
    return {
      session: opts.ctx.session,
      user: opts.ctx.user,
    };
  }),

  // 支出を保存（認証必須）
  createExpense: protectedProcedure
    .input(expenseInputSchema)
    .mutation(async (opts) => {
      const {
        id,
        amount,
        category,
        memo,
        date,
        createdAt,
        updatedAt,
        deviceId,
      } = opts.input;
      const userId = opts.ctx.user.id; // 認証済みユーザーのIDを使用

      // DBを取得（D1を使用）
      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      // 既存データをチェック（重複登録防止）
      const existing = await database
        .select()
        .from(expenses)
        .where(eq(expenses.id, id))
        .get();

      if (existing) {
        // 既に存在する場合はupdatedAtで更新判定
        if (new Date(existing.updatedAt) < new Date(updatedAt)) {
          await database
            .update(expenses)
            .set({
              amount,
              category: category || null,
              memo: memo || null,
              date,
              updatedAt,
              deviceId,
            })
            .where(eq(expenses.id, id))
            .run();

          try {
            await deliverExpenseWebhooks({
              database,
              env: opts.ctx.env,
              userId,
              expense: opts.input,
              event: 'expense.updated',
            });
          } catch (error) {
            console.error('[Webhook] Failed to deliver expense.updated', error);
          }

          return { success: true, updated: true };
        }

        return { success: true, updated: false, message: 'Already up to date' };
      }

      // 新規挿入
      await database
        .insert(expenses)
        .values({
          id,
          userId,
          amount,
          category: category || null,
          memo: memo || null,
          date,
          createdAt,
          updatedAt,
          deviceId,
        })
        .run();

      try {
        await deliverExpenseWebhooks({
          database,
          env: opts.ctx.env,
          userId,
          expense: opts.input,
          event: 'expense.created',
        });
      } catch (error) {
        console.error('[Webhook] Failed to deliver expense.created', error);
      }

      return { success: true, created: true };
    }),

  // 支出を取得（月別）（認証必須）
  getExpenses: protectedProcedure
    .input(getExpensesInputSchema)
    .query(async (opts) => {
      const userId = opts.ctx.user.id;

      // month パラメータが指定されていない場合は現在の月を使用
      let month = opts.input.month;
      if (!month) {
        const now = new Date();
        const year = now.getFullYear();
        const monthNum = String(now.getMonth() + 1).padStart(2, '0');
        month = `${year}-${monthNum}`;
      }

      // DBを取得（D1を使用）
      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      // 月の範囲を計算
      const startDate = `${month}-01`;
      const endDate = `${month}-31`; // 簡易的な実装

      const results = await database
        .select()
        .from(expenses)
        .where(
          and(
            eq(expenses.userId, userId),
            gte(expenses.date, startDate),
            lte(expenses.date, endDate)
          )
        )
        .all();

      return { expenses: results, month };
    }),

  // 支出を更新（認証必須）
  updateExpense: protectedProcedure
    .input(updateExpenseInputSchema)
    .mutation(async (opts) => {
      const { id, amount, category, memo, date, updatedAt, deviceId } =
        opts.input;
      const userId = opts.ctx.user.id;

      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      // 既存データを確認
      const existing = await database
        .select()
        .from(expenses)
        .where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
        .get();

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Expense not found',
        });
      }

      // updatedAt が新しい場合のみ更新
      if (new Date(existing.updatedAt) >= new Date(updatedAt)) {
        return { success: true, updated: false, message: 'Already up to date' };
      }

      await database
        .update(expenses)
        .set({
          amount: amount ?? existing.amount,
          category:
            category !== undefined ? category || null : existing.category,
          memo: memo !== undefined ? memo || null : existing.memo,
          date: date ?? existing.date,
          updatedAt,
          deviceId,
        })
        .where(eq(expenses.id, id))
        .run();

      return { success: true, updated: true };
    }),

  // 支出を削除（認証必須）
  deleteExpense: protectedProcedure
    .input(deleteExpenseInputSchema)
    .mutation(async (opts) => {
      const { id } = opts.input;
      const userId = opts.ctx.user.id;

      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      // 削除
      await database
        .delete(expenses)
        .where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
        .run();

      return { success: true };
    }),

  // 予算を取得（認証必須）
  // 指定月の予算が見つからない場合、最新の過去の予算を引き継ぐ
  getBudget: protectedProcedure.input(budgetInputSchema).query(async (opts) => {
    const { month } = opts.input;
    const userId = opts.ctx.user.id;

    // DBを取得（D1を使用）
    const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

    // 指定月の予算を取得
    const result = await database
      .select()
      .from(budgets)
      .where(and(eq(budgets.userId, userId), eq(budgets.month, month)))
      .get();

    // 指定月の予算が見つかった場合はそれを返す
    if (result) {
      return { budget: result };
    }

    // 見つからない場合、最新の過去の予算を取得して引き継ぐ
    const latestBudget = await database
      .select()
      .from(budgets)
      .where(eq(budgets.userId, userId))
      .orderBy(desc(budgets.month))
      .limit(1)
      .get();

    return { budget: latestBudget };
  }),

  // 予算を更新（認証必須）
  updateBudget: protectedProcedure
    .input(updateBudgetInputSchema)
    .mutation(async (opts) => {
      const { month, amount } = opts.input;
      const userId = opts.ctx.user.id;
      const updatedAt = new Date().toISOString();

      // DBを取得（D1を使用）
      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      // 既存の予算をチェック
      const existing = await database
        .select()
        .from(budgets)
        .where(and(eq(budgets.userId, userId), eq(budgets.month, month)))
        .get();

      if (existing) {
        // 更新
        await database
          .update(budgets)
          .set({
            amount,
            updatedAt,
          })
          .where(eq(budgets.id, existing.id))
          .run();

        return { success: true, updated: true };
      }

      // 新規挿入
      const id = `${userId}-${month}`;
      await database
        .insert(budgets)
        .values({
          id,
          userId,
          month,
          amount,
          updatedAt,
        })
        .run();

      return { success: true, created: true };
    }),

  // APIトークンを発行（認証必須）
  issueApiToken: protectedProcedure
    .input(issueApiTokenInputSchema)
    .mutation(async (opts) => {
      const { name } = opts.input;
      const userId = opts.ctx.user.id;
      const createdAt = new Date().toISOString();

      // DBを取得（D1を使用）
      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      // 安全なトークンを生成（128文字 = 512ビット）
      const token = generateSecureToken(128);
      const tokenHash = await hashToken(token);

      // トークンを保存（ハッシュのみ）
      await database
        .insert(apiTokens)
        .values({
          tokenHash,
          userId,
          name: name || null,
          createdAt,
          lastUsedAt: null,
          isActive: 1,
        })
        .run();

      return {
        token, // 平文トークンは1回だけ返す
        tokenHash,
        message: 'このトークンは再表示できません。安全に保管してください。',
      };
    }),

  // APIトークン一覧を取得（認証必須）
  listApiTokens: protectedProcedure.query(async (opts) => {
    const userId = opts.ctx.user.id;

    // DBを取得（D1を使用）
    const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

    const tokens = await database
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.userId, userId))
      .orderBy(desc(apiTokens.createdAt))
      .all();

    return { tokens };
  }),

  // APIトークンを無効化（認証必須）
  revokeApiToken: protectedProcedure
    .input(revokeApiTokenInputSchema)
    .mutation(async (opts) => {
      const { tokenHash } = opts.input;
      const userId = opts.ctx.user.id;

      // DBを取得（D1を使用）
      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      // トークンの所有者を確認
      const token = await database
        .select()
        .from(apiTokens)
        .where(
          and(eq(apiTokens.tokenHash, tokenHash), eq(apiTokens.userId, userId))
        )
        .get();

      if (!token) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Token not found',
        });
      }

      // 無効化
      await database
        .update(apiTokens)
        .set({ isActive: 0 })
        .where(eq(apiTokens.tokenHash, tokenHash))
        .run();

      return { success: true };
    }),

  // Webhook一覧を取得（認証必須）
  listWebhooks: protectedProcedure.query(async (opts) => {
    const userId = opts.ctx.user.id;

    const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

    const targets = await database
      .select()
      .from(webhooks)
      .where(eq(webhooks.userId, userId))
      .orderBy(desc(webhooks.createdAt))
      .all();

    return {
      webhooks: targets.map((target) => ({
        id: target.id,
        url: target.url,
        createdAt: target.createdAt,
        updatedAt: target.updatedAt,
        hasSecret: Boolean(target.secretEncrypted),
      })),
    };
  }),

  // Webhookを追加（認証必須）
  createWebhook: protectedProcedure
    .input(createWebhookInputSchema)
    .mutation(async (opts) => {
      const userId = opts.ctx.user.id;
      const { url, secret } = opts.input;
      const createdAt = new Date().toISOString();

      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      const existingCount = await database
        .select({ count: sql<number>`count(*)` })
        .from(webhooks)
        .where(eq(webhooks.userId, userId))
        .get();

      if ((existingCount?.count ?? 0) >= 5) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Webhookは最大5件まで登録できます。',
        });
      }

      let secretEncrypted: string | null = null;
      let secretIv: string | null = null;

      if (secret) {
        if (!opts.ctx.env?.WEBHOOK_SECRET_KEY) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Webhook secret key is not configured',
          });
        }

        const encrypted = await encryptWebhookSecret(
          secret,
          opts.ctx.env.WEBHOOK_SECRET_KEY
        );
        secretEncrypted = encrypted.encrypted;
        secretIv = encrypted.iv;
      }

      const id = ulid();
      await database
        .insert(webhooks)
        .values({
          id,
          userId,
          url,
          secretEncrypted,
          secretIv,
          createdAt,
          updatedAt: createdAt,
        })
        .run();

      return {
        id,
        url,
        createdAt,
      };
    }),

  // Webhookを削除（認証必須）
  deleteWebhook: protectedProcedure
    .input(deleteWebhookInputSchema)
    .mutation(async (opts) => {
      const userId = opts.ctx.user.id;
      const { id } = opts.input;

      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      const existing = await database
        .select()
        .from(webhooks)
        .where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)))
        .get();

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Webhook not found',
        });
      }

      await database.delete(webhooks).where(eq(webhooks.id, id)).run();

      return { success: true };
    }),

  // アカウントデータ削除（D1の家計データのみ、認証必須）
  // 認証データ（user, session, account）の削除はBetterAuth経由で行う
  deleteAccountData: protectedProcedure.mutation(async (opts) => {
    const userId = opts.ctx.user.id;

    // DBを取得（D1を使用）
    const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

    // expensesを削除
    await database.delete(expenses).where(eq(expenses.userId, userId)).run();

    // budgetsを削除
    await database.delete(budgets).where(eq(budgets.userId, userId)).run();

    // apiTokensを削除
    await database.delete(apiTokens).where(eq(apiTokens.userId, userId)).run();

    // apiUsageを削除
    await database.delete(apiUsage).where(eq(apiUsage.userId, userId)).run();

    // webhooksを削除
    await database.delete(webhooks).where(eq(webhooks.userId, userId)).run();

    // 新規追加: サブスクリプション、定期支出、予算アラートも削除
    await database.delete(userSubscriptions).where(eq(userSubscriptions.userId, userId)).run();
    await database.delete(recurringExpenses).where(eq(recurringExpenses.userId, userId)).run();
    await database.delete(budgetAlerts).where(eq(budgetAlerts.userId, userId)).run();

    return { success: true };
  }),

  // ========================================
  // サブスクリプション関連
  // ========================================

  // サブスクリプション情報を取得（認証必須）
  getSubscription: protectedProcedure.query(async (opts) => {
    const userId = opts.ctx.user.id;
    const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

    const subscription = await database
      .select()
      .from(userSubscriptions)
      .where(and(
        eq(userSubscriptions.userId, userId),
        eq(userSubscriptions.status, 'active')
      ))
      .orderBy(desc(userSubscriptions.createdAt))
      .limit(1)
      .get();

    // サブスクリプションがない場合はfreeプランとして扱う
    if (!subscription) {
      return {
        subscription: null,
        plan: 'free' as const,
        isPremium: false,
        limits: FREE_PLAN_LIMITS,
      };
    }

    const sub: Subscription = {
      id: subscription.id,
      userId: subscription.userId,
      plan: subscription.plan as 'free' | 'premium',
      status: subscription.status as 'active' | 'canceled' | 'expired',
      startedAt: subscription.startedAt,
      expiresAt: subscription.expiresAt,
      canceledAt: subscription.canceledAt,
    };

    return {
      subscription: sub,
      plan: sub.plan,
      isPremium: isPremiumUser(sub),
      limits: isPremiumUser(sub) ? null : FREE_PLAN_LIMITS,
    };
  }),

  // 機能へのアクセス可否をチェック（認証必須）
  checkFeatureAccess: protectedProcedure
    .input(z.object({
      feature: z.enum([
        'category_analysis',
        'recurring_expenses',
        'budget_alerts',
        'csv_export',
        'multiple_budgets',
        'unlimited_webhooks',
      ]),
    }))
    .query(async (opts) => {
      const userId = opts.ctx.user.id;
      const { feature } = opts.input;
      const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

      // サブスクリプションを取得
      const subscription = await database
        .select()
        .from(userSubscriptions)
        .where(and(
          eq(userSubscriptions.userId, userId),
          eq(userSubscriptions.status, 'active')
        ))
        .orderBy(desc(userSubscriptions.createdAt))
        .limit(1)
        .get();

      const sub: Subscription | null = subscription ? {
        id: subscription.id,
        userId: subscription.userId,
        plan: subscription.plan as 'free' | 'premium',
        status: subscription.status as 'active' | 'canceled' | 'expired',
        startedAt: subscription.startedAt,
        expiresAt: subscription.expiresAt,
        canceledAt: subscription.canceledAt,
      } : null;

      // 現在の使用量を取得
      let currentUsage = 0;
      if (feature === 'recurring_expenses') {
        const count = await database
          .select({ count: sql<number>`count(*)` })
          .from(recurringExpenses)
          .where(and(
            eq(recurringExpenses.userId, userId),
            eq(recurringExpenses.isActive, 1)
          ))
          .get();
        currentUsage = count?.count ?? 0;
      } else if (feature === 'budget_alerts') {
        const count = await database
          .select({ count: sql<number>`count(*)` })
          .from(budgetAlerts)
          .where(and(
            eq(budgetAlerts.userId, userId),
            eq(budgetAlerts.isEnabled, 1)
          ))
          .get();
        currentUsage = count?.count ?? 0;
      } else if (feature === 'unlimited_webhooks') {
        const count = await database
          .select({ count: sql<number>`count(*)` })
          .from(webhooks)
          .where(eq(webhooks.userId, userId))
          .get();
        currentUsage = count?.count ?? 0;
      }

      return canUseFeature(feature, sub, currentUsage);
    }),

  // ========================================
  // 定期支出関連
  // ========================================

  // 定期支出一覧を取得（認証必須）
  listRecurringExpenses: protectedProcedure.query(async (opts) => {
    const userId = opts.ctx.user.id;
    const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

    const results = await database
      .select()
      .from(recurringExpenses)
      .where(eq(recurringExpenses.userId, userId))
      .orderBy(recurringExpenses.dayOfMonth)
      .all();

    return { recurringExpenses: results };
  }),

  // 定期支出を作成（認証必須）
  createRecurringExpense: protectedProcedure
    .input(createRecurringExpenseInputSchema)
    .mutation(async (opts) => {
      const userId = opts.ctx.user.id;
      const { amount, category, memo, dayOfMonth } = opts.input;
      const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

      // サブスクリプションをチェック
      const subscription = await database
        .select()
        .from(userSubscriptions)
        .where(and(
          eq(userSubscriptions.userId, userId),
          eq(userSubscriptions.status, 'active')
        ))
        .orderBy(desc(userSubscriptions.createdAt))
        .limit(1)
        .get();

      const sub: Subscription | null = subscription ? {
        id: subscription.id,
        userId: subscription.userId,
        plan: subscription.plan as 'free' | 'premium',
        status: subscription.status as 'active' | 'canceled' | 'expired',
        startedAt: subscription.startedAt,
        expiresAt: subscription.expiresAt,
        canceledAt: subscription.canceledAt,
      } : null;

      // 現在の定期支出数を取得
      const count = await database
        .select({ count: sql<number>`count(*)` })
        .from(recurringExpenses)
        .where(and(
          eq(recurringExpenses.userId, userId),
          eq(recurringExpenses.isActive, 1)
        ))
        .get();

      const currentUsage = count?.count ?? 0;
      const access = canUseFeature('recurring_expenses', sub, currentUsage);

      if (!access.allowed) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `定期支出は${access.limit}件まで登録できます。プレミアムプランにアップグレードすると無制限で登録できます。`,
        });
      }

      const now = new Date().toISOString();
      const id = ulid();

      await database
        .insert(recurringExpenses)
        .values({
          id,
          userId,
          amount,
          category: category || null,
          memo: memo || null,
          dayOfMonth,
          isActive: 1,
          lastGeneratedMonth: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      return { id, success: true };
    }),

  // 定期支出を更新（認証必須）
  updateRecurringExpense: protectedProcedure
    .input(updateRecurringExpenseInputSchema)
    .mutation(async (opts) => {
      const userId = opts.ctx.user.id;
      const { id, amount, category, memo, dayOfMonth, isActive } = opts.input;
      const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

      // 既存データを確認
      const existing = await database
        .select()
        .from(recurringExpenses)
        .where(and(
          eq(recurringExpenses.id, id),
          eq(recurringExpenses.userId, userId)
        ))
        .get();

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '定期支出が見つかりません',
        });
      }

      await database
        .update(recurringExpenses)
        .set({
          amount: amount ?? existing.amount,
          category: category !== undefined ? (category || null) : existing.category,
          memo: memo !== undefined ? (memo || null) : existing.memo,
          dayOfMonth: dayOfMonth ?? existing.dayOfMonth,
          isActive: isActive !== undefined ? (isActive ? 1 : 0) : existing.isActive,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(recurringExpenses.id, id))
        .run();

      return { success: true };
    }),

  // 定期支出を削除（認証必須）
  deleteRecurringExpense: protectedProcedure
    .input(deleteRecurringExpenseInputSchema)
    .mutation(async (opts) => {
      const userId = opts.ctx.user.id;
      const { id } = opts.input;
      const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

      await database
        .delete(recurringExpenses)
        .where(and(
          eq(recurringExpenses.id, id),
          eq(recurringExpenses.userId, userId)
        ))
        .run();

      return { success: true };
    }),

  // 定期支出から今月分の支出を生成（認証必須）
  generateRecurringExpenses: protectedProcedure.mutation(async (opts) => {
    const userId = opts.ctx.user.id;
    const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // アクティブな定期支出を取得
    const activeRecurring = await database
      .select()
      .from(recurringExpenses)
      .where(and(
        eq(recurringExpenses.userId, userId),
        eq(recurringExpenses.isActive, 1)
      ))
      .all();

    const generated: string[] = [];

    for (const recurring of activeRecurring) {
      // 既に今月分が生成済みならスキップ
      if (recurring.lastGeneratedMonth === currentMonth) {
        continue;
      }

      // 支出を生成
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const lastDay = new Date(year, month, 0).getDate();
      const day = Math.min(recurring.dayOfMonth, lastDay);
      const date = `${currentMonth}-${String(day).padStart(2, '0')}`;

      const expenseId = ulid();
      const createdAt = new Date().toISOString();

      await database
        .insert(expenses)
        .values({
          id: expenseId,
          userId,
          amount: recurring.amount,
          category: recurring.category,
          memo: recurring.memo ? `[定期] ${recurring.memo}` : '[定期支出]',
          date,
          createdAt,
          updatedAt: createdAt,
          deviceId: 'recurring-system',
        })
        .run();

      // 生成済み月を更新
      await database
        .update(recurringExpenses)
        .set({
          lastGeneratedMonth: currentMonth,
          updatedAt: createdAt,
        })
        .where(eq(recurringExpenses.id, recurring.id))
        .run();

      generated.push(expenseId);
    }

    return { generated, count: generated.length };
  }),

  // ========================================
  // 予算アラート関連
  // ========================================

  // 予算アラート一覧を取得（認証必須）
  listBudgetAlerts: protectedProcedure.query(async (opts) => {
    const userId = opts.ctx.user.id;
    const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

    const results = await database
      .select()
      .from(budgetAlerts)
      .where(eq(budgetAlerts.userId, userId))
      .orderBy(budgetAlerts.thresholdPercent)
      .all();

    return { alerts: results };
  }),

  // 予算アラートを作成（認証必須）
  createBudgetAlert: protectedProcedure
    .input(createBudgetAlertInputSchema)
    .mutation(async (opts) => {
      const userId = opts.ctx.user.id;
      const { thresholdPercent, thresholdAmount } = opts.input;
      const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

      // サブスクリプションをチェック
      const subscription = await database
        .select()
        .from(userSubscriptions)
        .where(and(
          eq(userSubscriptions.userId, userId),
          eq(userSubscriptions.status, 'active')
        ))
        .orderBy(desc(userSubscriptions.createdAt))
        .limit(1)
        .get();

      const sub: Subscription | null = subscription ? {
        id: subscription.id,
        userId: subscription.userId,
        plan: subscription.plan as 'free' | 'premium',
        status: subscription.status as 'active' | 'canceled' | 'expired',
        startedAt: subscription.startedAt,
        expiresAt: subscription.expiresAt,
        canceledAt: subscription.canceledAt,
      } : null;

      // 現在のアラート数を取得
      const count = await database
        .select({ count: sql<number>`count(*)` })
        .from(budgetAlerts)
        .where(and(
          eq(budgetAlerts.userId, userId),
          eq(budgetAlerts.isEnabled, 1)
        ))
        .get();

      const currentUsage = count?.count ?? 0;
      const access = canUseFeature('budget_alerts', sub, currentUsage);

      if (!access.allowed) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `予算アラートは${access.limit}件まで設定できます。プレミアムプランにアップグレードすると無制限で設定できます。`,
        });
      }

      const now = new Date().toISOString();
      const id = ulid();

      await database
        .insert(budgetAlerts)
        .values({
          id,
          userId,
          thresholdPercent,
          thresholdAmount: thresholdAmount ?? null,
          isEnabled: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      return { id, success: true };
    }),

  // 予算アラートを更新（認証必須）
  updateBudgetAlert: protectedProcedure
    .input(updateBudgetAlertInputSchema)
    .mutation(async (opts) => {
      const userId = opts.ctx.user.id;
      const { id, thresholdPercent, thresholdAmount, isEnabled } = opts.input;
      const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

      // 既存データを確認
      const existing = await database
        .select()
        .from(budgetAlerts)
        .where(and(
          eq(budgetAlerts.id, id),
          eq(budgetAlerts.userId, userId)
        ))
        .get();

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '予算アラートが見つかりません',
        });
      }

      await database
        .update(budgetAlerts)
        .set({
          thresholdPercent: thresholdPercent ?? existing.thresholdPercent,
          thresholdAmount: thresholdAmount !== undefined ? (thresholdAmount ?? null) : existing.thresholdAmount,
          isEnabled: isEnabled !== undefined ? (isEnabled ? 1 : 0) : existing.isEnabled,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(budgetAlerts.id, id))
        .run();

      return { success: true };
    }),

  // 予算アラートを削除（認証必須）
  deleteBudgetAlert: protectedProcedure
    .input(deleteBudgetAlertInputSchema)
    .mutation(async (opts) => {
      const userId = opts.ctx.user.id;
      const { id } = opts.input;
      const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

      await database
        .delete(budgetAlerts)
        .where(and(
          eq(budgetAlerts.id, id),
          eq(budgetAlerts.userId, userId)
        ))
        .run();

      return { success: true };
    }),

  // ========================================
  // カテゴリ分析関連
  // ========================================

  // カテゴリ別支出集計（認証必須）
  getCategoryAnalysis: protectedProcedure
    .input(getCategoryAnalysisInputSchema)
    .query(async (opts) => {
      const userId = opts.ctx.user.id;
      const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

      // 基準月を決定
      const now = new Date();
      const baseMonth = opts.input.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const monthsToFetch = opts.input.months || 1;

      // サブスクリプションをチェックして取得可能な月数を制限
      const subscription = await database
        .select()
        .from(userSubscriptions)
        .where(and(
          eq(userSubscriptions.userId, userId),
          eq(userSubscriptions.status, 'active')
        ))
        .orderBy(desc(userSubscriptions.createdAt))
        .limit(1)
        .get();

      const sub: Subscription | null = subscription ? {
        id: subscription.id,
        userId: subscription.userId,
        plan: subscription.plan as 'free' | 'premium',
        status: subscription.status as 'active' | 'canceled' | 'expired',
        startedAt: subscription.startedAt,
        expiresAt: subscription.expiresAt,
        canceledAt: subscription.canceledAt,
      } : null;

      const access = canUseFeature('category_analysis', sub);
      const maxMonths = access.limit ?? 12;
      const actualMonths = Math.min(monthsToFetch, maxMonths);

      // 対象期間を計算
      const [baseYear, baseMonthNum] = baseMonth.split('-').map(Number);
      const startDate = new Date(baseYear!, baseMonthNum! - actualMonths, 1);
      const startMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-01`;
      const endMonth = `${baseMonth}-31`;

      // 支出を取得
      const results = await database
        .select()
        .from(expenses)
        .where(and(
          eq(expenses.userId, userId),
          gte(expenses.date, startMonth),
          lte(expenses.date, endMonth)
        ))
        .all();

      // カテゴリ別に集計
      const categoryTotals: Record<string, number> = {};
      let total = 0;

      for (const expense of results) {
        const category = expense.category || 'other';
        categoryTotals[category] = (categoryTotals[category] || 0) + expense.amount;
        total += expense.amount;
      }

      // 割合を計算
      const analysis = Object.entries(categoryTotals).map(([category, amount]) => ({
        category,
        amount,
        percentage: total > 0 ? Math.round((amount / total) * 100) : 0,
      })).sort((a, b) => b.amount - a.amount);

      return {
        analysis,
        total,
        period: {
          start: startMonth.slice(0, 7),
          end: baseMonth,
          months: actualMonths,
        },
        isPremiumRequired: monthsToFetch > maxMonths,
      };
    }),

  // 月別支出推移を取得（認証必須）
  getMonthlyTrend: protectedProcedure
    .input(z.object({
      months: z.number().min(1).max(12).optional(),
    }))
    .query(async (opts) => {
      const userId = opts.ctx.user.id;
      const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

      const monthsToFetch = opts.input.months || 6;

      // サブスクリプションをチェック
      const subscription = await database
        .select()
        .from(userSubscriptions)
        .where(and(
          eq(userSubscriptions.userId, userId),
          eq(userSubscriptions.status, 'active')
        ))
        .orderBy(desc(userSubscriptions.createdAt))
        .limit(1)
        .get();

      const sub: Subscription | null = subscription ? {
        id: subscription.id,
        userId: subscription.userId,
        plan: subscription.plan as 'free' | 'premium',
        status: subscription.status as 'active' | 'canceled' | 'expired',
        startedAt: subscription.startedAt,
        expiresAt: subscription.expiresAt,
        canceledAt: subscription.canceledAt,
      } : null;

      const access = canUseFeature('category_analysis', sub);
      const maxMonths = access.limit ?? 12;
      const actualMonths = Math.min(monthsToFetch, maxMonths);

      // 対象期間を計算
      const now = new Date();
      const trends: { month: string; total: number; budget: number | null }[] = [];

      for (let i = 0; i < actualMonths; i++) {
        const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const month = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
        const startDate = `${month}-01`;
        const endDate = `${month}-31`;

        // その月の支出合計
        const expenseResult = await database
          .select({ total: sql<number>`COALESCE(SUM(amount), 0)` })
          .from(expenses)
          .where(and(
            eq(expenses.userId, userId),
            gte(expenses.date, startDate),
            lte(expenses.date, endDate)
          ))
          .get();

        // その月の予算
        const budgetResult = await database
          .select()
          .from(budgets)
          .where(and(
            eq(budgets.userId, userId),
            eq(budgets.month, month)
          ))
          .get();

        trends.push({
          month,
          total: expenseResult?.total ?? 0,
          budget: budgetResult?.amount ?? null,
        });
      }

      return {
        trends: trends.reverse(), // 古い順に並べ替え
        isPremiumRequired: monthsToFetch > maxMonths,
      };
    }),

});

export type AppRouter = typeof appRouter;
