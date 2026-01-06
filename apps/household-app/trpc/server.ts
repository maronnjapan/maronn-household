import type { dbD1 } from "../database/drizzle/db";
import { initTRPC, TRPCError } from "@trpc/server";
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, lte } from 'drizzle-orm';
import { expenses, budgets } from '../database/drizzle/schema/household';
import { z } from 'zod';
import type { Session, User } from "better-auth/types";

/**
 * Cloudflare Workers環境変数の型定義
 */
interface Env {
  DB: D1Database;
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
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
      const { id, amount, category, memo, date, updatedAt, deviceId } = opts.input;
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
          category: category !== undefined ? (category || null) : existing.category,
          memo: memo !== undefined ? (memo || null) : existing.memo,
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
  getBudget: protectedProcedure
    .input(budgetInputSchema)
    .query(async (opts) => {
      const { month } = opts.input;
      const userId = opts.ctx.user.id;

      // DBを取得（D1を使用）
      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      // 指定月の予算を取得
      const result = await database
        .select()
        .from(budgets)
        .where(
          and(
            eq(budgets.userId, userId),
            eq(budgets.month, month)
          )
        )
        .get();

      return { budget: result };
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
        .where(
          and(
            eq(budgets.userId, userId),
            eq(budgets.month, month)
          )
        )
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
});

export type AppRouter = typeof appRouter;
