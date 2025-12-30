import type { dbD1 } from "../database/drizzle/db";
import { initTRPC } from "@trpc/server";
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, lte } from 'drizzle-orm';
import { expenses, budgets } from '../database/drizzle/schema/household';
import { z } from 'zod';

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.context<{ db: ReturnType<typeof dbD1>; env?: { DB: D1Database } }>().create();

/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
export const router = t.router;
export const publicProcedure = t.procedure;

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
  // デモエンドポイント
  demo: publicProcedure.query(async () => {
    return { demo: true, message: "Household app tRPC is working!" };
  }),

  // 支出を保存
  createExpense: publicProcedure
    .input(expenseInputSchema)
    .mutation(async (opts) => {
      const { id, amount, category, memo, date, createdAt, updatedAt, deviceId } = opts.input;

      // DBを取得（contextにenvがあればそちらを使う）
      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      // 認証未実装のため、デフォルトユーザーを使用
      const userId = 'default-user';

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

  // 支出を取得（月別）
  getExpenses: publicProcedure
    .input(getExpensesInputSchema)
    .query(async (opts) => {
      // month パラメータが指定されていない場合は現在の月を使用
      let month = opts.input.month;
      if (!month) {
        const now = new Date();
        const year = now.getFullYear();
        const monthNum = String(now.getMonth() + 1).padStart(2, '0');
        month = `${year}-${monthNum}`;
      }

      // DBを取得（contextにenvがあればそちらを使う）
      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      const userId = 'default-user';

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

  // 支出を更新
  updateExpense: publicProcedure
    .input(updateExpenseInputSchema)
    .mutation(async (opts) => {
      const { id, amount, category, memo, date, updatedAt, deviceId } = opts.input;

      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      const userId = 'default-user';

      // 既存データを確認
      const existing = await database
        .select()
        .from(expenses)
        .where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
        .get();

      if (!existing) {
        return { success: false, message: 'Expense not found' };
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

  // 支出を削除
  deleteExpense: publicProcedure
    .input(deleteExpenseInputSchema)
    .mutation(async (opts) => {
      const { id } = opts.input;

      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      const userId = 'default-user';

      // 削除
      await database
        .delete(expenses)
        .where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
        .run();

      return { success: true };
    }),

  // 予算を取得
  getBudget: publicProcedure
    .input(budgetInputSchema)
    .query(async (opts) => {
      const { month } = opts.input;

      // DBを取得
      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      const userId = 'default-user';

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

  // 予算を更新
  updateBudget: publicProcedure
    .input(updateBudgetInputSchema)
    .mutation(async (opts) => {
      const { month, amount } = opts.input;

      // DBを取得
      const database = opts.ctx.env?.DB
        ? drizzle(opts.ctx.env.DB)
        : opts.ctx.db;

      const userId = 'default-user';
      const updatedAt = new Date().toISOString();

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
