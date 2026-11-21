/**
 * 家計データ（支出・予算・レシート・カテゴリー）の D1 への読み書き
 *
 * 1 人のユーザーのデータだけを扱う。MCP サーバーなどのアダプターは、認証したユーザーでこのストアを作る。
 * 計算などの純粋なロジックは @maronn/domain に置く。
 */
import { and, asc, count, desc, eq, gte, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import {
  budgets,
  categories,
  expenses,
  receiptItems,
  receipts,
} from '@maronn/db-schema/household';
import {
  categoryMatchKey,
  resolveCategories,
  type Category,
  type CategoryChange,
} from '@maronn/domain/categories';
import {
  monthDateRange,
  summarizeSpending,
  type planReceiptRecording,
} from '@maronn/domain/receipt';

/** 予算が一度も設定されていないときの月の予算（household-app と同じ） */
export const DEFAULT_BUDGET_AMOUNT = 120_000;

export type ReceiptRecording = ReturnType<typeof planReceiptRecording>;

export function createHouseholdStore(d1: D1Database, userId: string) {
  const db = drizzle(d1);
  const receiptsBetween = (start: string, end: string) =>
    and(
      eq(receipts.userId, userId),
      gte(receipts.purchasedAt, start),
      lt(receipts.purchasedAt, end)
    );
  const expensesIn = (month: string) => {
    const { start, end } = monthDateRange(month);
    return and(
      eq(expenses.userId, userId),
      gte(expenses.date, start),
      lt(expenses.date, end)
    );
  };

  const categoryRow = (change: CategoryChange) => ({
    userId,
    ...change,
    labelKey: categoryMatchKey(change.label),
    createdAt: change.updatedAt,
  });

  return {
    /**
     * 同じ購入日・同じ支払総額の記録（二重登録の候補）
     * - レシート（支出がすべて消されたレシートは、アプリで取り消されたものとみなして含めない）
     * - アプリなどレシート以外で記録した支出（店で金額だけ記録し、後でレシートを送る使い方で同じ会計を二重に記録しないように）
     */
    async findSameDayRecords(date: string, totalAmount: number) {
      const sameReceipts = await db
        .selectDistinct({
          id: receipts.id,
          storeName: receipts.storeName,
          purchasedAt: receipts.purchasedAt,
        })
        .from(receipts)
        .innerJoin(expenses, eq(expenses.receiptId, receipts.id))
        .where(
          and(
            receiptsBetween(date, `${date}~`),
            eq(receipts.totalAmount, totalAmount)
          )
        )
        .all();
      const sameExpenses = await db
        .select({
          id: expenses.id,
          date: expenses.date,
          amount: expenses.amount,
          category: expenses.category,
          memo: expenses.memo,
        })
        .from(expenses)
        .where(
          and(
            eq(expenses.userId, userId),
            eq(expenses.date, date),
            eq(expenses.amount, totalAmount),
            isNull(expenses.receiptId)
          )
        )
        .all();
      return { receipts: sameReceipts, expenses: sameExpenses };
    },

    /** レシートと、その支払総額の支出（内訳付き）を一つのバッチ（トランザクション）で保存する */
    async saveReceipt({ receipt, expense }: ReceiptRecording) {
      await db.batch([db.insert(receipts).values(receipt), db.insert(expenses).values(expense)]);
    },

    /** レシートを取り消す（支出は内訳ごと削除、以前の記録の明細は外部キーの cascade で削除）。消したら true */
    async deleteReceipt(receiptId: string): Promise<boolean> {
      const [, removed] = await db.batch([
        db
          .delete(expenses)
          .where(
            and(eq(expenses.receiptId, receiptId), eq(expenses.userId, userId))
          ),
        db
          .delete(receipts)
          .where(and(eq(receipts.id, receiptId), eq(receipts.userId, userId))),
      ]);
      return removed.meta.changes > 0;
    },

    /** 月の支出（1回の会計ごと。レシート由来の支出は店名付き、items は内訳） */
    listExpenses(month: string) {
      return db
        .select({
          id: expenses.id,
          date: expenses.date,
          amount: expenses.amount,
          category: expenses.category,
          memo: expenses.memo,
          subBudgetId: expenses.subBudgetId,
          receiptId: expenses.receiptId,
          storeName: receipts.storeName,
          items: expenses.items,
        })
        .from(expenses)
        .leftJoin(receipts, eq(receipts.id, expenses.receiptId))
        .where(expensesIn(month))
        .orderBy(asc(expenses.date))
        .all();
    },

    /**
     * 月に購入したレシート（アプリで支出をすべて消して取り消したレシートは含めない）
     * items は以前の記録（receipt_items）の明細だけ。今のレシートの明細は支出の内訳（expenses.items）にある
     */
    async listReceipts(month: string) {
      const { start, end } = monthDateRange(month);
      const active = and(
        receiptsBetween(start, end),
        sql`exists (select 1 from ${expenses} where ${expenses.receiptId} = ${receipts.id})`
      );
      const found = await db
        .select({
          id: receipts.id,
          storeName: receipts.storeName,
          purchasedAt: receipts.purchasedAt,
          totalAmount: receipts.totalAmount,
          taxAmount: receipts.taxAmount,
          paymentMethod: receipts.paymentMethod,
        })
        .from(receipts)
        .where(active)
        .orderBy(asc(receipts.purchasedAt))
        .all();
      const items = await db
        .select({
          receiptId: receiptItems.receiptId,
          name: receiptItems.name,
          amount: receiptItems.amount,
          quantity: receiptItems.quantity,
          category: receiptItems.category,
        })
        .from(receiptItems)
        .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
        .where(active)
        .orderBy(asc(receiptItems.position))
        .all();
      return found.map((receipt) => ({
        ...receipt,
        items: items
          .filter((item) => item.receiptId === receipt.id)
          .map(({ receiptId: _receiptId, ...item }) => item),
      }));
    },

    /**
     * 月の予算に対する支出状況
     * 予算はその月の設定、なければ直近の過去月の設定を引き継ぐ。サブ予算の支出はアプリの「残り」と同じく含めない
     */
    async getBudgetSummary(month: string) {
      const budget = await db
        .select({ amount: budgets.amount })
        .from(budgets)
        .where(and(eq(budgets.userId, userId), lte(budgets.month, month)))
        .orderBy(desc(budgets.month))
        .get();
      const spent = await db
        .select({ amount: expenses.amount, category: expenses.category, items: expenses.items })
        .from(expenses)
        .where(and(expensesIn(month), isNull(expenses.subBudgetId)))
        .all();
      return summarizeSpending(budget?.amount ?? DEFAULT_BUDGET_AMOUNT, spent);
    },

    /** カテゴリーの一覧（既定のカテゴリーに、このユーザーの追加・名前変更・削除を重ねたもの。削除済みを含む） */
    async listCategories(): Promise<Category[]> {
      const records = await db
        .select({
          value: categories.value,
          label: categories.label,
          deletedAt: categories.deletedAt,
          createdAt: categories.createdAt,
        })
        .from(categories)
        .where(eq(categories.userId, userId))
        .all();
      return resolveCategories(records);
    },

    /**
     * 新しく作るカテゴリーを保存する。
     * 同じ名前の有効なカテゴリーが（同時に作られて）すでにあれば保存せずに false
     */
    async addCategory(change: CategoryChange): Promise<boolean> {
      const result = await db
        .insert(categories)
        .values(categoryRow(change))
        .onConflictDoNothing()
        .run();
      return result.meta.changes > 0;
    },

    /** 既存のカテゴリー（行のない既定のカテゴリーを含む）の名前変更・削除・復元を保存する */
    async saveCategory(change: CategoryChange) {
      const row = categoryRow(change);
      await db
        .insert(categories)
        .values(row)
        .onConflictDoUpdate({
          target: [categories.userId, categories.value],
          set: {
            label: row.label,
            labelKey: row.labelKey,
            deletedAt: row.deletedAt,
            updatedAt: row.updatedAt,
          },
        })
        .run();
    },

    /** そのカテゴリーの支出の件数（全期間。会計のカテゴリーか、内訳のどれかがそのカテゴリーの支出） */
    async countExpensesInCategory(value: string): Promise<number> {
      const inItems = sql`exists (select 1 from json_each(${expenses.items}) where json_extract(json_each.value, '$.category') = ${value})`;
      const row = await db
        .select({ n: count() })
        .from(expenses)
        .where(and(eq(expenses.userId, userId), or(eq(expenses.category, value), inItems)))
        .get();
      return row?.n ?? 0;
    },
  };
}

export type HouseholdStore = ReturnType<typeof createHouseholdStore>;
