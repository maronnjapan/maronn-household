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
  webhookBatchSchedules,
  subBudgets,
  subBudgetMonthlyAmounts,
} from '../database/drizzle/schema/household';
import { z } from 'zod';
import { generateSecureToken, hashToken } from '../lib/api-token';
import {
  encryptWebhookSecret,
  decryptWithKeyFallback,
  reEncrypt,
} from '../lib/webhook-secret';
import { createWebhookSignature } from '../lib/webhook-signature';
import { ulid } from 'ulidx';
import type { Session, User } from 'better-auth/types';
import {
  calculateTotalAllocated,
  getEffectiveMonthlyAmount as getEffectiveAmount,
  calculateSubBudgetCarryover,
  buildDefaultEventPayload,
  buildEventPayloadFromTemplate,
  calculateNextExecution,
  getWebhookTemplatePreset,
  validateWebhookTemplateUrl,
  applyHeaderValues,
  applyBodyTemplateValues,
  listWebhookTemplatePresets as listTemplatePresets,
  type ScheduleConfig,
  type WebhookServiceType,
} from '@maronn/domain';

/**
 * Cloudflare Workers環境変数の型定義
 */
interface Env {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  WEBHOOK_SECRET_KEY: string;
  /** キーローテーション時の旧キー。ローテーション完了後に削除する */
  WEBHOOK_SECRET_KEY_OLD?: string;
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
  subBudgetId: z.string().optional(),
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
  customHeaders: z.record(z.string()).optional(),
  bodyTemplate: z.string().optional(),
});

const updateWebhookInputSchema = z.object({
  id: z.string(),
  url: z.string().url().optional(),
  secret: z.string().nullable().optional(),
  customHeaders: z.record(z.string()).nullable().optional(),
  bodyTemplate: z.string().nullable().optional(),
});

const deleteWebhookInputSchema = z.object({
  id: z.string(),
});

const createWebhookBatchScheduleInputSchema = z.object({
  webhookId: z.string(),
  scheduleType: z.enum(['hourly', 'daily', 'weekly', 'monthly']),
  hour: z.number().min(0).max(23).optional(),
  dayOfWeek: z.number().min(0).max(6).optional(),
  dayOfMonth: z.number().min(1).max(31).optional(),
  bodyTemplate: z.string().optional(),
  customHeaders: z.record(z.string()).optional(),
});

const updateWebhookBatchScheduleInputSchema = z.object({
  id: z.string(),
  scheduleType: z.enum(['hourly', 'daily', 'weekly', 'monthly']).optional(),
  hour: z.number().min(0).max(23).nullable().optional(),
  dayOfWeek: z.number().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().min(1).max(31).nullable().optional(),
  bodyTemplate: z.string().nullable().optional(),
  customHeaders: z.record(z.string()).nullable().optional(),
  isActive: z.boolean().optional(),
});

const deleteWebhookBatchScheduleInputSchema = z.object({
  id: z.string(),
});

const createWebhookFromTemplateInputSchema = z.object({
  service: z.enum(['line', 'slack', 'spreadsheet']),
  url: z.string().url(),
  /** ヘッダーのプレースホルダー値（例: LINE_CHANNEL_ACCESS_TOKEN） */
  headerValues: z.record(z.string()).optional(),
  /** ボディテンプレートのプレースホルダー値（例: LINE_USER_ID） */
  bodyTemplateValues: z.record(z.string()).optional(),
  /** HMAC署名用シークレット */
  secret: z.string().optional(),
});

const listWebhookTemplatePresetsInputSchema = z.object({}).optional();

const createSubBudgetInputSchema = z.object({
  name: z.string().min(1),
  amount: z.number().min(0),
  startMonth: z.string(),
});

const updateSubBudgetInputSchema = z.object({
  id: z.string(),
  name: z.string().min(1).optional(),
  amount: z.number().min(0).optional(),
  month: z.string(),
});

const deleteSubBudgetInputSchema = z.object({
  id: z.string(),
});

const getSubBudgetDetailInputSchema = z.object({
  id: z.string(),
  month: z.string(),
});

/**
 * カスタムヘッダーを暗号化する（AES-GCM）
 * シークレット（Authorization等）が平文でDBに残らないようにする
 */
async function encryptCustomHeaders(
  headers: Record<string, string>,
  secretKey: string
): Promise<{ encrypted: string; iv: string }> {
  return encryptWebhookSecret(JSON.stringify(headers), secretKey);
}

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

  await Promise.allSettled(
    targets.map(async (target) => {
      // ボディテンプレートが設定されている場合はテンプレートを使用
      const payload = target.bodyTemplate
        ? buildEventPayloadFromTemplate(
            target.bodyTemplate,
            event,
            userId,
            expense
          )
        : buildDefaultEventPayload(event, userId, expense);

      // デフォルトヘッダー
      const headers = new Headers({
        'Content-Type': 'application/json',
        'X-Household-Webhook-Event': event,
        'X-Household-Webhook-Id': target.id,
      });

      // カスタムヘッダーを復号してマージ（キーフォールバック対応）
      if (target.customHeaders && target.customHeadersIv && env?.WEBHOOK_SECRET_KEY) {
        const { decrypted: headersJson } = await decryptWithKeyFallback(
          target.customHeaders,
          target.customHeadersIv,
          env.WEBHOOK_SECRET_KEY,
          env.WEBHOOK_SECRET_KEY_OLD
        );
        const custom = JSON.parse(headersJson) as Record<string, string>;
        for (const [key, value] of Object.entries(custom)) {
          headers.set(key, value);
        }
      }

      // HMAC署名（キーフォールバック対応）
      if (target.secretEncrypted && target.secretIv) {
        if (!env?.WEBHOOK_SECRET_KEY) {
          console.error('[Webhook] Missing WEBHOOK_SECRET_KEY for signing');
          return;
        }
        const { decrypted: webhookSecret } = await decryptWithKeyFallback(
          target.secretEncrypted,
          target.secretIv,
          env.WEBHOOK_SECRET_KEY,
          env.WEBHOOK_SECRET_KEY_OLD
        );
        const signature = await createWebhookSignature(webhookSecret, payload);
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
        subBudgetId,
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
              subBudgetId: subBudgetId || null,
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
          subBudgetId: subBudgetId || null,
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

    const secretKey = opts.ctx.env?.WEBHOOK_SECRET_KEY;
    const oldKey = opts.ctx.env?.WEBHOOK_SECRET_KEY_OLD;

    const webhookResults = await Promise.all(
      targets.map(async (target) => {
        let customHeaders: Record<string, string> | null = null;
        if (target.customHeaders && target.customHeadersIv && secretKey) {
          const { decrypted } = await decryptWithKeyFallback(
            target.customHeaders,
            target.customHeadersIv,
            secretKey,
            oldKey
          );
          customHeaders = JSON.parse(decrypted) as Record<string, string>;
        }
        return {
          id: target.id,
          url: target.url,
          createdAt: target.createdAt,
          updatedAt: target.updatedAt,
          hasSecret: Boolean(target.secretEncrypted),
          customHeaders,
          bodyTemplate: target.bodyTemplate,
        };
      })
    );

    return { webhooks: webhookResults };
  }),

  // Webhookを追加（認証必須）
  createWebhook: protectedProcedure
    .input(createWebhookInputSchema)
    .mutation(async (opts) => {
      const userId = opts.ctx.user.id;
      const { url, secret, customHeaders, bodyTemplate } = opts.input;
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

      let encryptedHeaders: string | null = null;
      let headersIv: string | null = null;

      if (customHeaders) {
        if (!opts.ctx.env?.WEBHOOK_SECRET_KEY) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Webhook secret key is not configured',
          });
        }
        const encrypted = await encryptCustomHeaders(
          customHeaders,
          opts.ctx.env.WEBHOOK_SECRET_KEY
        );
        encryptedHeaders = encrypted.encrypted;
        headersIv = encrypted.iv;
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
          customHeaders: encryptedHeaders,
          customHeadersIv: headersIv,
          bodyTemplate: bodyTemplate || null,
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

  // Webhookを更新（認証必須）
  updateWebhook: protectedProcedure
    .input(updateWebhookInputSchema)
    .mutation(async (opts) => {
      const userId = opts.ctx.user.id;
      const { id, url, secret, customHeaders, bodyTemplate } = opts.input;
      const updatedAt = new Date().toISOString();

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

      const updates: Record<string, unknown> = { updatedAt };

      if (url !== undefined) {
        updates.url = url;
      }

      if (secret !== undefined) {
        if (secret === null) {
          updates.secretEncrypted = null;
          updates.secretIv = null;
        } else {
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
          updates.secretEncrypted = encrypted.encrypted;
          updates.secretIv = encrypted.iv;
        }
      }

      if (customHeaders !== undefined) {
        if (customHeaders === null) {
          updates.customHeaders = null;
          updates.customHeadersIv = null;
        } else {
          if (!opts.ctx.env?.WEBHOOK_SECRET_KEY) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Webhook secret key is not configured',
            });
          }
          const encrypted = await encryptCustomHeaders(
            customHeaders,
            opts.ctx.env.WEBHOOK_SECRET_KEY
          );
          updates.customHeaders = encrypted.encrypted;
          updates.customHeadersIv = encrypted.iv;
        }
      }

      if (bodyTemplate !== undefined) {
        updates.bodyTemplate = bodyTemplate;
      }

      await database
        .update(webhooks)
        .set(updates)
        .where(eq(webhooks.id, id))
        .run();

      return { success: true };
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

      // 紐づくバッチスケジュールも削除
      await database
        .delete(webhookBatchSchedules)
        .where(eq(webhookBatchSchedules.webhookId, id))
        .run();

      await database.delete(webhooks).where(eq(webhooks.id, id)).run();

      return { success: true };
    }),

  // サブ予算一覧取得（認証必須）
  getSubBudgets: protectedProcedure.query(async (opts) => {
    const userId = opts.ctx.user.id;
    const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

    const results = await database
      .select()
      .from(subBudgets)
      .where(eq(subBudgets.userId, userId))
      .orderBy(desc(subBudgets.createdAt))
      .all();

    return { subBudgets: results };
  }),

  // サブ予算作成（認証必須）
  createSubBudget: protectedProcedure
    .input(createSubBudgetInputSchema)
    .mutation(async (opts) => {
      const { name, amount, startMonth } = opts.input;
      const userId = opts.ctx.user.id;
      const now = new Date().toISOString();

      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      const id = ulid();
      await database
        .insert(subBudgets)
        .values({
          id,
          userId,
          name,
          amount,
          startMonth,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      // 開始月の月別金額を記録
      await database
        .insert(subBudgetMonthlyAmounts)
        .values({
          id: `${id}-${startMonth}`,
          subBudgetId: id,
          userId,
          month: startMonth,
          amount,
          updatedAt: now,
        })
        .run();

      return { id, success: true };
    }),

  // サブ予算更新（認証必須）
  updateSubBudget: protectedProcedure
    .input(updateSubBudgetInputSchema)
    .mutation(async (opts) => {
      const { id, name, amount, month } = opts.input;
      const userId = opts.ctx.user.id;
      const now = new Date().toISOString();

      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      const existing = await database
        .select()
        .from(subBudgets)
        .where(and(eq(subBudgets.id, id), eq(subBudgets.userId, userId)))
        .get();

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Sub-budget not found',
        });
      }

      const updates: Record<string, unknown> = { updatedAt: now };
      if (name !== undefined) updates.name = name;
      if (amount !== undefined) updates.amount = amount;

      await database
        .update(subBudgets)
        .set(updates)
        .where(eq(subBudgets.id, id))
        .run();

      // 金額変更時は月別金額を記録（繰り越し計算用）
      if (amount !== undefined) {
        const monthlyId = `${id}-${month}`;
        const existingMonthly = await database
          .select()
          .from(subBudgetMonthlyAmounts)
          .where(eq(subBudgetMonthlyAmounts.id, monthlyId))
          .get();

        if (existingMonthly) {
          await database
            .update(subBudgetMonthlyAmounts)
            .set({ amount, updatedAt: now })
            .where(eq(subBudgetMonthlyAmounts.id, monthlyId))
            .run();
        } else {
          await database
            .insert(subBudgetMonthlyAmounts)
            .values({
              id: monthlyId,
              subBudgetId: id,
              userId,
              month,
              amount,
              updatedAt: now,
            })
            .run();
        }
      }

      return { success: true };
    }),

  // サブ予算削除（認証必須）
  deleteSubBudget: protectedProcedure
    .input(deleteSubBudgetInputSchema)
    .mutation(async (opts) => {
      const { id } = opts.input;
      const userId = opts.ctx.user.id;

      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      const existing = await database
        .select()
        .from(subBudgets)
        .where(and(eq(subBudgets.id, id), eq(subBudgets.userId, userId)))
        .get();

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Sub-budget not found',
        });
      }

      // 月別金額も削除
      await database
        .delete(subBudgetMonthlyAmounts)
        .where(eq(subBudgetMonthlyAmounts.subBudgetId, id))
        .run();

      // サブ予算本体を削除
      await database.delete(subBudgets).where(eq(subBudgets.id, id)).run();

      // 紐づく支出のsubBudgetIdをnullに更新
      await database
        .update(expenses)
        .set({ subBudgetId: null })
        .where(and(eq(expenses.subBudgetId, id), eq(expenses.userId, userId)))
        .run();

      return { success: true };
    }),

  // サブ予算詳細取得（繰り越し計算込み、認証必須）
  getSubBudgetDetail: protectedProcedure
    .input(getSubBudgetDetailInputSchema)
    .query(async (opts) => {
      const { id, month } = opts.input;
      const userId = opts.ctx.user.id;

      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      // サブ予算を取得
      const subBudget = await database
        .select()
        .from(subBudgets)
        .where(and(eq(subBudgets.id, id), eq(subBudgets.userId, userId)))
        .get();

      if (!subBudget) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Sub-budget not found',
        });
      }

      // 月別金額設定を取得（ソート済み）
      const monthlyAmounts = await database
        .select()
        .from(subBudgetMonthlyAmounts)
        .where(eq(subBudgetMonthlyAmounts.subBudgetId, id))
        .all();
      const monthlyAmountsSorted = [...monthlyAmounts].sort((a, b) =>
        a.month.localeCompare(b.month)
      );

      // 過去月の支出合計（startMonth〜対象月の前月）をSQL SUMで取得
      const pastExpensesResult = await database
        .select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)` })
        .from(expenses)
        .where(
          and(
            eq(expenses.userId, userId),
            eq(expenses.subBudgetId, id),
            gte(expenses.date, `${subBudget.startMonth}-01`),
            lte(expenses.date, `${month}-00`)
          )
        )
        .get();
      const totalPastExpenses = pastExpensesResult?.total ?? 0;

      // 過去月の予算合計（区間ごとに「レート×月数」で合算、月ループなし）
      const totalAllocated = calculateTotalAllocated(
        subBudget.startMonth,
        month,
        monthlyAmountsSorted,
        subBudget.amount
      );

      // 繰り越し = 過去の予算合計 - 過去の支出合計
      const carryover = calculateSubBudgetCarryover(totalAllocated, totalPastExpenses);

      // 今月の有効金額
      const currentMonthAmount = getEffectiveAmount(
        month,
        monthlyAmountsSorted,
        subBudget.amount
      );

      // 今月の支出合計をSQL SUMで取得
      const currentExpensesResult = await database
        .select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)` })
        .from(expenses)
        .where(
          and(
            eq(expenses.userId, userId),
            eq(expenses.subBudgetId, id),
            gte(expenses.date, `${month}-01`),
            lte(expenses.date, `${month}-31`)
          )
        )
        .get();
      const currentMonthSpent = currentExpensesResult?.total ?? 0;

      return {
        subBudget,
        monthlyAmount: currentMonthAmount,
        carryover,
        available: currentMonthAmount + carryover,
        spent: currentMonthSpent,
        remaining: currentMonthAmount + carryover - currentMonthSpent,
      };
    }),

  // バッチスケジュール一覧取得（認証必須）
  listWebhookBatchSchedules: protectedProcedure.query(async (opts) => {
    const userId = opts.ctx.user.id;
    const database = opts.ctx.env?.DB ? drizzle(opts.ctx.env.DB) : opts.ctx.db;

    const schedules = await database
      .select()
      .from(webhookBatchSchedules)
      .where(eq(webhookBatchSchedules.userId, userId))
      .orderBy(desc(webhookBatchSchedules.createdAt))
      .all();

    const secretKey = opts.ctx.env?.WEBHOOK_SECRET_KEY;
    const oldSecretKey = opts.ctx.env?.WEBHOOK_SECRET_KEY_OLD;

    const scheduleResults = await Promise.all(
      schedules.map(async (s) => {
        let customHeaders: Record<string, string> | null = null;
        if (s.customHeaders && s.customHeadersIv && secretKey) {
          const { decrypted } = await decryptWithKeyFallback(
            s.customHeaders,
            s.customHeadersIv,
            secretKey,
            oldSecretKey
          );
          customHeaders = JSON.parse(decrypted) as Record<string, string>;
        }
        return {
          id: s.id,
          webhookId: s.webhookId,
          scheduleType: s.scheduleType,
          hour: s.hour,
          dayOfWeek: s.dayOfWeek,
          dayOfMonth: s.dayOfMonth,
          bodyTemplate: s.bodyTemplate,
          customHeaders,
          isActive: Boolean(s.isActive),
          lastExecutedAt: s.lastExecutedAt,
          nextExecutionAt: s.nextExecutionAt,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        };
      })
    );

    return { schedules: scheduleResults };
  }),

  // バッチスケジュール作成（認証必須）
  createWebhookBatchSchedule: protectedProcedure
    .input(createWebhookBatchScheduleInputSchema)
    .mutation(async (opts) => {
      const userId = opts.ctx.user.id;
      const {
        webhookId,
        scheduleType,
        hour,
        dayOfWeek,
        dayOfMonth,
        bodyTemplate,
        customHeaders,
      } = opts.input;
      const now = new Date();
      const createdAt = now.toISOString();

      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      // 対象webhookの所有者確認
      const webhook = await database
        .select()
        .from(webhooks)
        .where(and(eq(webhooks.id, webhookId), eq(webhooks.userId, userId)))
        .get();

      if (!webhook) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Webhook not found',
        });
      }

      // 次回実行時刻を計算
      const config: ScheduleConfig = {
        scheduleType,
        hour,
        dayOfWeek,
        dayOfMonth,
      };
      const nextExecution = calculateNextExecution(config, now);

      let encryptedHeaders: string | null = null;
      let headersIv: string | null = null;

      if (customHeaders) {
        if (!opts.ctx.env?.WEBHOOK_SECRET_KEY) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Webhook secret key is not configured',
          });
        }
        const encrypted = await encryptCustomHeaders(
          customHeaders,
          opts.ctx.env.WEBHOOK_SECRET_KEY
        );
        encryptedHeaders = encrypted.encrypted;
        headersIv = encrypted.iv;
      }

      const id = ulid();
      await database
        .insert(webhookBatchSchedules)
        .values({
          id,
          userId,
          webhookId,
          scheduleType,
          hour: hour ?? null,
          dayOfWeek: dayOfWeek ?? null,
          dayOfMonth: dayOfMonth ?? null,
          bodyTemplate: bodyTemplate || null,
          customHeaders: encryptedHeaders,
          customHeadersIv: headersIv,
          isActive: 1,
          lastExecutedAt: null,
          nextExecutionAt: nextExecution.toISOString(),
          createdAt,
          updatedAt: createdAt,
        })
        .run();

      return {
        id,
        nextExecutionAt: nextExecution.toISOString(),
        createdAt,
      };
    }),

  // バッチスケジュール更新（認証必須）
  updateWebhookBatchSchedule: protectedProcedure
    .input(updateWebhookBatchScheduleInputSchema)
    .mutation(async (opts) => {
      const userId = opts.ctx.user.id;
      const {
        id,
        scheduleType,
        hour,
        dayOfWeek,
        dayOfMonth,
        bodyTemplate,
        customHeaders,
        isActive,
      } = opts.input;
      const now = new Date();
      const updatedAt = now.toISOString();

      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      const existing = await database
        .select()
        .from(webhookBatchSchedules)
        .where(
          and(
            eq(webhookBatchSchedules.id, id),
            eq(webhookBatchSchedules.userId, userId)
          )
        )
        .get();

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Batch schedule not found',
        });
      }

      const updates: Record<string, unknown> = { updatedAt };

      if (scheduleType !== undefined) updates.scheduleType = scheduleType;
      if (hour !== undefined) updates.hour = hour;
      if (dayOfWeek !== undefined) updates.dayOfWeek = dayOfWeek;
      if (dayOfMonth !== undefined) updates.dayOfMonth = dayOfMonth;
      if (bodyTemplate !== undefined) updates.bodyTemplate = bodyTemplate;
      if (customHeaders !== undefined) {
        if (customHeaders === null) {
          updates.customHeaders = null;
          updates.customHeadersIv = null;
        } else {
          if (!opts.ctx.env?.WEBHOOK_SECRET_KEY) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Webhook secret key is not configured',
            });
          }
          const encrypted = await encryptCustomHeaders(
            customHeaders,
            opts.ctx.env.WEBHOOK_SECRET_KEY
          );
          updates.customHeaders = encrypted.encrypted;
          updates.customHeadersIv = encrypted.iv;
        }
      }
      if (isActive !== undefined) updates.isActive = isActive ? 1 : 0;

      // スケジュール設定が変更された場合、次回実行時刻を再計算
      const newScheduleType = (scheduleType ?? existing.scheduleType) as ScheduleConfig['scheduleType'];
      const newHour = hour !== undefined ? hour : existing.hour;
      const newDayOfWeek = dayOfWeek !== undefined ? dayOfWeek : existing.dayOfWeek;
      const newDayOfMonth = dayOfMonth !== undefined ? dayOfMonth : existing.dayOfMonth;

      const config: ScheduleConfig = {
        scheduleType: newScheduleType,
        hour: newHour ?? undefined,
        dayOfWeek: newDayOfWeek ?? undefined,
        dayOfMonth: newDayOfMonth ?? undefined,
      };
      const nextExecution = calculateNextExecution(config, now);
      updates.nextExecutionAt = nextExecution.toISOString();

      await database
        .update(webhookBatchSchedules)
        .set(updates)
        .where(eq(webhookBatchSchedules.id, id))
        .run();

      return {
        success: true,
        nextExecutionAt: nextExecution.toISOString(),
      };
    }),

  // バッチスケジュール削除（認証必須）
  deleteWebhookBatchSchedule: protectedProcedure
    .input(deleteWebhookBatchScheduleInputSchema)
    .mutation(async (opts) => {
      const userId = opts.ctx.user.id;
      const { id } = opts.input;

      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      const existing = await database
        .select()
        .from(webhookBatchSchedules)
        .where(
          and(
            eq(webhookBatchSchedules.id, id),
            eq(webhookBatchSchedules.userId, userId)
          )
        )
        .get();

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Batch schedule not found',
        });
      }

      await database
        .delete(webhookBatchSchedules)
        .where(eq(webhookBatchSchedules.id, id))
        .run();

      return { success: true };
    }),

  // Webhookテンプレートプリセット一覧取得
  listWebhookTemplatePresets: publicProcedure.query(() => {
    return { presets: listTemplatePresets() };
  }),

  // テンプレートからWebhookを作成（認証必須）
  createWebhookFromTemplate: protectedProcedure
    .input(createWebhookFromTemplateInputSchema)
    .mutation(async (opts) => {
      const userId = opts.ctx.user.id;
      const { service, url, headerValues, bodyTemplateValues, secret } = opts.input;
      const createdAt = new Date().toISOString();

      // テンプレートプリセットを取得
      const preset = getWebhookTemplatePreset(service);
      if (!preset) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `不明なサービス種別: ${service}`,
        });
      }

      // URL バリデーション
      const urlValidation = validateWebhookTemplateUrl(service as WebhookServiceType, url);
      if (!urlValidation.valid) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: urlValidation.message ?? 'URLが不正です',
        });
      }

      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      // 上限チェック
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

      // ヘッダーを構築（プレースホルダーをユーザー値で置換）
      const customHeaders = applyHeaderValues(preset, headerValues ?? {});

      // ボディテンプレートを構築（ユーザー固有値を埋め込み）
      const eventBodyTemplate = applyBodyTemplateValues(
        preset.eventBodyTemplate,
        bodyTemplateValues ?? {}
      );

      // シークレット暗号化
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

      // カスタムヘッダー暗号化
      let encryptedHeaders: string | null = null;
      let headersIv: string | null = null;

      if (Object.keys(customHeaders).length > 0) {
        if (!opts.ctx.env?.WEBHOOK_SECRET_KEY) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Webhook secret key is not configured',
          });
        }
        const encrypted = await encryptCustomHeaders(
          customHeaders,
          opts.ctx.env.WEBHOOK_SECRET_KEY
        );
        encryptedHeaders = encrypted.encrypted;
        headersIv = encrypted.iv;
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
          customHeaders: encryptedHeaders,
          customHeadersIv: headersIv,
          bodyTemplate: eventBodyTemplate,
          createdAt,
          updatedAt: createdAt,
        })
        .run();

      return {
        id,
        url,
        service,
        createdAt,
      };
    }),

  // 暗号化キーのローテーション（認証必須）
  // WEBHOOK_SECRET_KEY を更新した後、旧キー(WEBHOOK_SECRET_KEY_OLD)から
  // 新キー(WEBHOOK_SECRET_KEY)へ全暗号化データを再暗号化する
  rotateSecretKey: protectedProcedure.mutation(async (opts) => {
    const userId = opts.ctx.user.id;

    const newKey = opts.ctx.env?.WEBHOOK_SECRET_KEY;
    const oldKey = opts.ctx.env?.WEBHOOK_SECRET_KEY_OLD;

    if (!newKey) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'WEBHOOK_SECRET_KEY is not configured',
      });
    }

    if (!oldKey) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'WEBHOOK_SECRET_KEY_OLD が設定されていません。ローテーションするには旧キーを WEBHOOK_SECRET_KEY_OLD に設定してください。',
      });
    }

    const database = opts.ctx.env?.DB
      ? drizzle(opts.ctx.env.DB)
      : opts.ctx.db;

    // 1. webhooks テーブルの暗号化データを再暗号化
    const userWebhooks = await database
      .select()
      .from(webhooks)
      .where(eq(webhooks.userId, userId))
      .all();

    let rotatedWebhookCount = 0;

    for (const webhook of userWebhooks) {
      const updates: Record<string, unknown> = {};
      let needsUpdate = false;

      // シークレットの再暗号化
      if (webhook.secretEncrypted && webhook.secretIv) {
        const result = await decryptWithKeyFallback(
          webhook.secretEncrypted,
          webhook.secretIv,
          newKey,
          oldKey
        );
        if (result.usedOldKey) {
          const reEncrypted = await reEncrypt(
            webhook.secretEncrypted,
            webhook.secretIv,
            oldKey,
            newKey
          );
          updates.secretEncrypted = reEncrypted.encrypted;
          updates.secretIv = reEncrypted.iv;
          needsUpdate = true;
        }
      }

      // カスタムヘッダーの再暗号化
      if (webhook.customHeaders && webhook.customHeadersIv) {
        const result = await decryptWithKeyFallback(
          webhook.customHeaders,
          webhook.customHeadersIv,
          newKey,
          oldKey
        );
        if (result.usedOldKey) {
          const reEncrypted = await reEncrypt(
            webhook.customHeaders,
            webhook.customHeadersIv,
            oldKey,
            newKey
          );
          updates.customHeaders = reEncrypted.encrypted;
          updates.customHeadersIv = reEncrypted.iv;
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        updates.updatedAt = new Date().toISOString();
        await database
          .update(webhooks)
          .set(updates)
          .where(eq(webhooks.id, webhook.id))
          .run();
        rotatedWebhookCount++;
      }
    }

    // 2. webhookBatchSchedules テーブルの暗号化データを再暗号化
    const userSchedules = await database
      .select()
      .from(webhookBatchSchedules)
      .where(eq(webhookBatchSchedules.userId, userId))
      .all();

    let rotatedScheduleCount = 0;

    for (const schedule of userSchedules) {
      if (schedule.customHeaders && schedule.customHeadersIv) {
        const result = await decryptWithKeyFallback(
          schedule.customHeaders,
          schedule.customHeadersIv,
          newKey,
          oldKey
        );
        if (result.usedOldKey) {
          const reEncrypted = await reEncrypt(
            schedule.customHeaders,
            schedule.customHeadersIv,
            oldKey,
            newKey
          );
          await database
            .update(webhookBatchSchedules)
            .set({
              customHeaders: reEncrypted.encrypted,
              customHeadersIv: reEncrypted.iv,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(webhookBatchSchedules.id, schedule.id))
            .run();
          rotatedScheduleCount++;
        }
      }
    }

    return {
      success: true,
      rotatedWebhooks: rotatedWebhookCount,
      rotatedSchedules: rotatedScheduleCount,
      message: `ローテーション完了。Webhook: ${rotatedWebhookCount}件、スケジュール: ${rotatedScheduleCount}件を再暗号化しました。WEBHOOK_SECRET_KEY_OLD を削除してください。`,
    };
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

    // webhookBatchSchedulesを削除
    await database.delete(webhookBatchSchedules).where(eq(webhookBatchSchedules.userId, userId)).run();

    // webhooksを削除
    await database.delete(webhooks).where(eq(webhooks.userId, userId)).run();

    // subBudgetMonthlyAmountsを削除
    await database.delete(subBudgetMonthlyAmounts).where(eq(subBudgetMonthlyAmounts.userId, userId)).run();

    // subBudgetsを削除
    await database.delete(subBudgets).where(eq(subBudgets.userId, userId)).run();

    return { success: true };
  }),

});

export type AppRouter = typeof appRouter;
