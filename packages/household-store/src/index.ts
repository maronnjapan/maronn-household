/**
 * 家計データ（支出・予算・レシート）の D1 への読み書き
 *
 * 1 人のユーザーのデータだけを扱う。MCP サーバーなどのアダプターは、認証したユーザーでこのストアを作る。
 * 計算などの純粋なロジックは @maronn/domain に置く。
 */
import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import {
  budgets,
  expenses,
  receiptItems,
  receipts,
} from '@maronn/db-schema/household';
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

  return {
    /**
     * 同じ購入日・同じ支払総額のレシート（二重登録の候補）
     * 支出がすべて消されたレシートは、アプリで取り消されたものとみなして含めない
     */
    findSameDayReceipts(date: string, totalAmount: number) {
      return db
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
    },

    /** レシート・明細・按分した支出を一つのバッチ（トランザクション）で保存する */
    async saveReceipt({ receipt, items, expenses: allocated }: ReceiptRecording) {
      await db.batch([
        db.insert(receipts).values(receipt),
        ...items.map((item) => db.insert(receiptItems).values(item)),
        ...allocated.map((expense) => db.insert(expenses).values(expense)),
      ]);
    },

    /** レシートを取り消す（明細は外部キーの cascade、按分した支出も削除）。消したら true */
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

    /** 月の支出（レシート由来の支出は店名付き） */
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
        })
        .from(expenses)
        .leftJoin(receipts, eq(receipts.id, expenses.receiptId))
        .where(expensesIn(month))
        .orderBy(asc(expenses.date))
        .all();
    },

    /** 月に購入したレシートと明細（アプリで支出をすべて消して取り消したレシートは含めない） */
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
        .select({ amount: expenses.amount, category: expenses.category })
        .from(expenses)
        .where(and(expensesIn(month), isNull(expenses.subBudgetId)))
        .all();
      return summarizeSpending(budget?.amount ?? DEFAULT_BUDGET_AMOUNT, spent);
    },
  };
}
