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
} from '../database/drizzle/schema/household';
import { z } from 'zod';
import { generateSecureToken, hashToken } from '../lib/api-token';
import {
  encryptWebhookSecret,
  decryptWebhookSecret,
} from '../lib/webhook-secret';
import { createWebhookSignature } from '../lib/webhook-signature';
import {
  createSESClient,
  sendEmail,
  buildContactEmailTemplate,
} from '../lib/email';
import { ulid } from 'ulidx';
import type { Session, User } from 'better-auth/types';

/**
 * Cloudflare Workers環境変数の型定義
 */
interface Env {
  DB: D1Database;
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  WEBHOOK_SECRET_KEY: string;
  // AWS SES設定
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
  CONTACT_EMAIL_FROM?: string;
  CONTACT_EMAIL_TO?: string;
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

const sendContactMessageInputSchema = z.object({
  name: z.string().min(1, 'お名前を入力してください'),
  email: z.string().email('有効なメールアドレスを入力してください'),
  subject: z.string().min(1, '件名を入力してください'),
  message: z.string().min(10, 'お問い合わせ内容は10文字以上で入力してください'),
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

  // アカウントデータ削除（D1のみ、認証必須）
  // PostgreSQLのユーザー削除はBetterAuth経由で行う
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

    return { success: true };
  }),

  // お問い合わせメール送信（認証不要）
  // お問い合わせメール送信（認証不要）
  sendContactMessage: publicProcedure
    .input(sendContactMessageInputSchema)
    .mutation(async (opts) => {
      const { name, email, subject, message } = opts.input;
      const env = opts.ctx.env;

      if (!env) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Server configuration error',
        });
      }

      const fromEmail = env.CONTACT_EMAIL_FROM;
      const toEmail = env.CONTACT_EMAIL_TO;
      const region = env.AWS_REGION || 'ap-northeast-1';
      const accessKeyId = env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;

      if (!fromEmail || !toEmail) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Email configuration is not set',
        });
      }

      if (!accessKeyId || !secretAccessKey) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'AWS credentials are not configured',
        });
      }

      // メールテンプレートを構築
      const emailTemplate = buildContactEmailTemplate({
        name,
        email,
        subject,
        message,
      });

      // SESクライアントを作成
      const sesClient = createSESClient({
        region,
        accessKeyId,
        secretAccessKey,
      });

      // AWS SES経由でメール送信
      await sendEmail(sesClient, {
        to: toEmail,
        from: fromEmail,
        subject: emailTemplate.subject,
        bodyText: emailTemplate.bodyText,
        bodyHtml: emailTemplate.bodyHtml,
        replyTo: email,
      });

      return { success: true };
    }),
});

export type AppRouter = typeof appRouter;
