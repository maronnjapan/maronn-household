import { describe, it, expect } from 'vitest';
import {
  planReceiptRecording,
  receiptDate,
  summarizeSpending,
  monthDateRange,
} from '../src/receipt';

describe('receiptDate', () => {
  it('日時文字列から YYYY-MM-DD を取り出す', () => {
    expect(receiptDate('2026-11-19T12:34:56+09:00')).toBe('2026-11-19');
    expect(receiptDate('2026-11-19')).toBe('2026-11-19');
  });

  it('日付として解釈できない文字列はエラーにする', () => {
    expect(() => receiptDate('11/19')).toThrow();
    expect(() => receiptDate('2026-13-01')).toThrow();
  });

  it('暦にない日付や時刻はエラーにする', () => {
    expect(() => receiptDate('2026-02-31')).toThrow();
    expect(() => receiptDate('2026-11-19T25:00')).toThrow();
    expect(() => receiptDate('2026-11-19T12:60')).toThrow();
    expect(receiptDate('2028-02-29T23:59')).toBe('2028-02-29');
  });
});

describe('summarizeSpending', () => {
  it('内訳のある支出は、支払総額を内訳の比率で按分してカテゴリ別内訳に入れる（支出合計は支払総額のまま）', () => {
    const result = summarizeSpending(10000, [
      {
        amount: 1100,
        category: null,
        items: [
          { name: '米', amount: 700, category: 'food' },
          { name: 'ティッシュ', amount: 300, category: 'daily-goods' },
        ],
      },
      { amount: 500, category: 'food', items: null },
    ]);

    expect(result).toEqual({
      budget: 10000,
      spent: 1600,
      remaining: 8400,
      byCategory: [
        { category: 'food', amount: 1270 },
        { category: 'daily-goods', amount: 330 },
      ],
    });
  });

  it('予算・支出合計・残額とカテゴリ別内訳（金額の多い順）を返す', () => {
    const result = summarizeSpending(10000, [
      { amount: 1000, category: 'food' },
      { amount: 3000, category: 'daily-goods' },
      { amount: 500, category: 'food' },
      { amount: 200, category: null },
    ]);

    expect(result).toEqual({
      budget: 10000,
      spent: 4700,
      remaining: 5300,
      byCategory: [
        { category: 'daily-goods', amount: 3000 },
        { category: 'food', amount: 1500 },
        { category: 'other', amount: 200 },
      ],
    });
  });
});

describe('monthDateRange', () => {
  it('月の初日と翌月の初日（範囲の終わり、含まない）を返す', () => {
    expect(monthDateRange('2026-11')).toEqual({ start: '2026-11-01', end: '2026-12-01' });
  });

  it('12月は翌年1月1日までにする', () => {
    expect(monthDateRange('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
  });

  it('YYYY-MM 形式でなければエラーにする', () => {
    expect(() => monthDateRange('2026-13')).toThrow();
    expect(() => monthDateRange('202611')).toThrow();
  });
});

describe('planReceiptRecording', () => {
  const ids = () => {
    let n = 0;
    return () => `id-${++n}`;
  };
  const context = {
    userId: 'user-1',
    clientId: 'dcr-claude',
    now: '2026-11-19T10:00:00.000Z',
  };

  it('レシート1枚を支払総額の支出1件にし、明細を内訳として持たせ、明細合計と支払総額の差を返す（会計のカテゴリーは主なカテゴリー）', () => {
    const plan = planReceiptRecording(
      {
        storeName: 'スーパーA',
        purchasedAt: '2026-11-19T18:30',
        totalAmount: 1100,
        taxAmount: 100,
        paymentMethod: 'credit_card',
        items: [
          { name: '米', amount: 700, category: 'food' },
          { name: 'ティッシュ', amount: 300, quantity: 2, category: 'daily-goods' },
        ],
      },
      { ...context, newId: ids() }
    );

    expect(plan.receipt).toEqual({
      id: 'id-1',
      userId: 'user-1',
      storeName: 'スーパーA',
      purchasedAt: '2026-11-19T18:30',
      totalAmount: 1100,
      taxAmount: 100,
      paymentMethod: 'credit_card',
      source: 'dcr-claude',
      createdAt: context.now,
      updatedAt: context.now,
    });
    expect(plan.expense).toEqual({
      id: 'id-2',
      userId: 'user-1',
      amount: 1100,
      category: 'food',
      memo: 'スーパーA',
      date: '2026-11-19',
      createdAt: context.now,
      updatedAt: context.now,
      deviceId: 'mcp:dcr-claude',
      receiptId: 'id-1',
      items: [
        { name: '米', amount: 700, category: 'food' },
        { name: 'ティッシュ', amount: 300, quantity: 2, category: 'daily-goods' },
      ],
    });
    expect(plan.byCategory).toEqual([
      { category: 'food', amount: 770 },
      { category: 'daily-goods', amount: 330 },
    ]);
    expect(plan.itemsTotal).toBe(1000);
    expect(plan.difference).toBe(100);
  });

  it('レシートのカテゴリーは支出（会計）のカテゴリーにし、カテゴリーのない明細にはそのカテゴリーを入れる', () => {
    const plan = planReceiptRecording(
      {
        storeName: 'コンビニ',
        purchasedAt: '2026-11-19',
        totalAmount: 450,
        category: 'food',
        items: [
          { name: 'おにぎり', amount: 150 },
          { name: '電池', amount: 300, category: 'daily-goods' },
        ],
      },
      { ...context, newId: ids() }
    );

    expect(plan.expense.category).toBe('food');
    expect(plan.expense.items).toEqual([
      { name: 'おにぎり', amount: 150, category: 'food' },
      { name: '電池', amount: 300, category: 'daily-goods' },
    ]);
    expect(plan.byCategory).toEqual([
      { category: 'food', amount: 150 },
      { category: 'daily-goods', amount: 300 },
    ]);
  });

  it('明細がなければ内訳のない支出1件にし、差は0とする', () => {
    const plan = planReceiptRecording(
      { storeName: '店', purchasedAt: '2026-11-19', totalAmount: 500, category: 'food' },
      { ...context, newId: ids() }
    );

    expect(plan.expense).toMatchObject({ amount: 500, category: 'food', memo: '店', items: null });
    expect(plan.byCategory).toEqual([{ category: 'food', amount: 500 }]);
    expect(plan.receipt.taxAmount).toBeNull();
    expect(plan.receipt.paymentMethod).toBeNull();
    expect(plan.itemsTotal).toBeNull();
    expect(plan.difference).toBe(0);
  });
});
