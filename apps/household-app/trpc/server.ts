import { initTRPC, TRPCError } from "@trpc/server";
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and, gte, lte } from 'drizzle-orm';
import { expenses, budgets } from '../database/drizzle/schema/household-pg';
import { user } from '../database/drizzle/schema/auth';
import { z } from 'zod';

/**
 * tRPCコンテキスト型定義
 * セッション情報とユーザー情報を含む
 */
interface Context {
  env?: {
    HYPERDRIVE: Hyperdrive;
    [key: string]: any;
  };
  session?: any;
  user?: {
    id: string;
    name: string;
    email: string;
    [key: string]: any;
  } | null;
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
 */
export const protectedProcedure = t.procedure.use(async (opts) => {
  const { ctx } = opts;

  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to access this resource',
    });
  }

  return opts.next({
    ctx: {
      ...ctx,
      user: ctx.user, // 型安全性のため
    },
  });
});

/**
 * DB接続を取得する共通ヘルパー
 */
function getDatabase(ctx: Context) {
  if (!ctx.env?.HYPERDRIVE) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Database connection not available',
    });
  }

  const client = postgres(ctx.env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  return drizzle(client, {
    schema: { ...expenses, ...budgets, ...user },
  });
}

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

export const appRouter = router({
  // デモエンドポイント（認証不要）
  demo: publicProcedure.query(async () => {
    return { demo: true, message: "Household app tRPC is working!" };
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
      const { id, amount, category, memo, date, createdAt, updatedAt, deviceId } = opts.input;
      const userId = opts.ctx.user.id; // 認証済みユーザーのIDを使用

      const db = getDatabase(opts.ctx);

      // 既存データをチェック（重複登録防止）
      const existing = await db
        .select()
        .from(expenses)
        .where(eq(expenses.id, id))
        .limit(1);

      if (existing.length > 0) {
        const existingExpense = existing[0];
        // 既に存在する場合はupdatedAtで更新判定
        if (new Date(existingExpense.updatedAt) < new Date(updatedAt)) {
          await db
            .update(expenses)
            .set({
              amount,
              category: category || null,
              memo: memo || null,
              date: new Date(date),
              updatedAt: new Date(updatedAt),
              deviceId,
            })
            .where(eq(expenses.id, id));

          return { success: true, updated: true };
        }

        return { success: true, updated: false, message: 'Already up to date' };
      }

      // 新規挿入
      await db
        .insert(expenses)
        .values({
          id,
          userId,
          amount,
          category: category || null,
          memo: memo || null,
          date: new Date(date),
          createdAt: new Date(createdAt),
          updatedAt: new Date(updatedAt),
          deviceId,
        });

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

      const db = getDatabase(opts.ctx);

      // 月の範囲を計算
      const startDate = new Date(`${month}-01T00:00:00Z`);
      const endDate = new Date(`${month}-31T23:59:59Z`); // 簡易的な実装

      const results = await db
        .select()
        .from(expenses)
        .where(
          and(
            eq(expenses.userId, userId),
            gte(expenses.date, startDate),
            lte(expenses.date, endDate)
          )
        );

      return { expenses: results, month };
    }),

  // 支出を更新（認証必須）
  updateExpense: protectedProcedure
    .input(updateExpenseInputSchema)
    .mutation(async (opts) => {
      const { id, amount, category, memo, date, updatedAt, deviceId } = opts.input;
      const userId = opts.ctx.user.id;

      const db = getDatabase(opts.ctx);

      // 既存データを確認
      const existing = await db
        .select()
        .from(expenses)
        .where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
        .limit(1);

      if (existing.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Expense not found',
        });
      }

      const existingExpense = existing[0];

      // updatedAt が新しい場合のみ更新
      if (new Date(existingExpense.updatedAt) >= new Date(updatedAt)) {
        return { success: true, updated: false, message: 'Already up to date' };
      }

      await db
        .update(expenses)
        .set({
          amount: amount ?? existingExpense.amount,
          category: category !== undefined ? (category || null) : existingExpense.category,
          memo: memo !== undefined ? (memo || null) : existingExpense.memo,
          date: date ? new Date(date) : existingExpense.date,
          updatedAt: new Date(updatedAt),
          deviceId,
        })
        .where(eq(expenses.id, id));

      return { success: true, updated: true };
    }),

  // 支出を削除（認証必須）
  deleteExpense: protectedProcedure
    .input(deleteExpenseInputSchema)
    .mutation(async (opts) => {
      const { id } = opts.input;
      const userId = opts.ctx.user.id;

      const db = getDatabase(opts.ctx);

      // 削除
      await db
        .delete(expenses)
        .where(and(eq(expenses.id, id), eq(expenses.userId, userId)));

      return { success: true };
    }),

  // 予算を取得（認証必須）
  getBudget: protectedProcedure
    .input(budgetInputSchema)
    .query(async (opts) => {
      const { month } = opts.input;
      const userId = opts.ctx.user.id;

      const db = getDatabase(opts.ctx);

      // 指定月の予算を取得
      const result = await db
        .select()
        .from(budgets)
        .where(
          and(
            eq(budgets.userId, userId),
            eq(budgets.month, month)
          )
        )
        .limit(1);

      return { budget: result.length > 0 ? result[0] : null };
    }),

  // 予算を更新（認証必須）
  updateBudget: protectedProcedure
    .input(updateBudgetInputSchema)
    .mutation(async (opts) => {
      const { month, amount } = opts.input;
      const userId = opts.ctx.user.id;
      const updatedAt = new Date();

      const db = getDatabase(opts.ctx);

      // 既存の予算をチェック
      const existing = await db
        .select()
        .from(budgets)
        .where(
          and(
            eq(budgets.userId, userId),
            eq(budgets.month, month)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        // 更新
        await db
          .update(budgets)
          .set({
            amount,
            updatedAt,
          })
          .where(eq(budgets.id, existing[0].id));

        return { success: true, updated: true };
      }

      // 新規挿入
      const id = `${userId}-${month}`;
      await db
        .insert(budgets)
        .values({
          id,
          userId,
          month,
          amount,
          updatedAt,
        });

      return { success: true, created: true };
    }),
});

export type AppRouter = typeof appRouter;
