import { describe, it, expect } from 'vitest';
import {
  allocateReceiptToExpenses,
  planReceiptRecording,
  receiptDate,
  summarizeSpending,
  monthDateRange,
} from '../src/receipt';

describe('allocateReceiptToExpenses', () => {
  it('明細がないレシートは合計金額で1件の支出になる', () => {
    const result = allocateReceiptToExpenses({
      storeName: 'スーパーA',
      purchasedAt: '2026-11-19',
      totalAmount: 1980,
      category: 'food',
    });

    expect(result).toEqual([{ category: 'food', amount: 1980, memo: 'スーパーA' }]);
  });

  it('カテゴリ指定がなければ other に計上する', () => {
    const result = allocateReceiptToExpenses({
      storeName: '雑貨店',
      purchasedAt: '2026-11-19',
      totalAmount: 500,
    });

    expect(result).toEqual([{ category: 'other', amount: 500, memo: '雑貨店' }]);
  });

  it('明細をカテゴリごとにまとめて支出にする', () => {
    const result = allocateReceiptToExpenses({
      storeName: 'ドラッグストアB',
      purchasedAt: '2026-11-19',
      totalAmount: 1000,
      items: [
        { name: '牛乳', amount: 300, category: 'food' },
        { name: '洗剤', amount: 400, category: 'daily-goods' },
        { name: 'パン', amount: 300, category: 'food' },
      ],
    });

    expect(result).toEqual([
      { category: 'food', amount: 600, memo: 'ドラッグストアB: 牛乳, パン' },
      { category: 'daily-goods', amount: 400, memo: 'ドラッグストアB: 洗剤' },
    ]);
  });

  it('明細合計と支払総額の差（消費税など）を明細金額の比率で按分し、合計を支払総額に一致させる', () => {
    const result = allocateReceiptToExpenses({
      storeName: 'スーパーA',
      purchasedAt: '2026-11-19',
      totalAmount: 1100,
      items: [
        { name: '米', amount: 700, category: 'food' },
        { name: 'ティッシュ', amount: 300, category: 'daily-goods' },
      ],
    });

    expect(result.map((e) => e.amount)).toEqual([770, 330]);
    expect(result.reduce((sum, e) => sum + e.amount, 0)).toBe(1100);
  });

  it('按分で端数が出ても合計は支払総額と一致する', () => {
    const result = allocateReceiptToExpenses({
      storeName: '店',
      purchasedAt: '2026-11-19',
      totalAmount: 100,
      items: [
        { name: 'a', amount: 1, category: 'food' },
        { name: 'b', amount: 1, category: 'daily-goods' },
        { name: 'c', amount: 1, category: 'other' },
      ],
    });

    expect(result.reduce((sum, e) => sum + e.amount, 0)).toBe(100);
    expect(result.map((e) => e.amount).sort()).toEqual([33, 33, 34]);
  });

  it('値引きで支払総額が明細合計より少ない場合も合計を一致させる', () => {
    const result = allocateReceiptToExpenses({
      storeName: '店',
      purchasedAt: '2026-11-19',
      totalAmount: 900,
      items: [
        { name: '肉', amount: 600, category: 'food' },
        { name: '電池', amount: 400, category: 'daily-goods' },
      ],
    });

    expect(result.map((e) => e.amount)).toEqual([540, 360]);
  });

  it('明細のカテゴリが未指定ならレシートのカテゴリ、それもなければ other を使う', () => {
    const withReceiptCategory = allocateReceiptToExpenses({
      storeName: '店',
      purchasedAt: '2026-11-19',
      totalAmount: 300,
      category: 'food',
      items: [{ name: 'おにぎり', amount: 300 }],
    });
    const withoutCategory = allocateReceiptToExpenses({
      storeName: '店',
      purchasedAt: '2026-11-19',
      totalAmount: 300,
      items: [{ name: 'なにか', amount: 300 }],
    });

    expect(withReceiptCategory[0]?.category).toBe('food');
    expect(withoutCategory[0]?.category).toBe('other');
  });

  it('メモの品名は3件までにして残りは件数で表す', () => {
    const result = allocateReceiptToExpenses({
      storeName: 'スーパーA',
      purchasedAt: '2026-11-19',
      totalAmount: 500,
      items: ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name, amount: 100, category: 'food' })),
    });

    expect(result[0]?.memo).toBe('スーパーA: a, b, c ほか2点');
  });

  it('按分後に0円になったカテゴリは支出にしない', () => {
    const result = allocateReceiptToExpenses({
      storeName: '店',
      purchasedAt: '2026-11-19',
      totalAmount: 500,
      items: [
        { name: '弁当', amount: 500, category: 'food' },
        { name: 'クーポン', amount: 0, category: 'other' },
      ],
    });

    expect(result).toEqual([{ category: 'food', amount: 500, memo: '店: 弁当' }]);
  });

  it('明細金額の合計が0なら支払総額を最初のカテゴリに計上する', () => {
    const result = allocateReceiptToExpenses({
      storeName: '店',
      purchasedAt: '2026-11-19',
      totalAmount: 200,
      items: [{ name: '無料品', amount: 0, category: 'food' }],
    });

    expect(result).toEqual([{ category: 'food', amount: 200, memo: '店: 無料品' }]);
  });
});

describe('receiptDate', () => {
  it('日時文字列から YYYY-MM-DD を取り出す', () => {
    expect(receiptDate('2026-11-19T12:34:56+09:00')).toBe('2026-11-19');
    expect(receiptDate('2026-11-19')).toBe('2026-11-19');
  });

  it('日付として解釈できない文字列はエラーにする', () => {
    expect(() => receiptDate('11/19')).toThrow();
    expect(() => receiptDate('2026-13-01')).toThrow();
  });
});

describe('summarizeSpending', () => {
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

  it('レシート・明細・按分した支出の行を作り、明細合計と支払総額の差を返す', () => {
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
    expect(plan.items).toEqual([
      { id: 'id-2', receiptId: 'id-1', position: 0, name: '米', amount: 700, quantity: null, category: 'food' },
      { id: 'id-3', receiptId: 'id-1', position: 1, name: 'ティッシュ', amount: 300, quantity: 2, category: 'daily-goods' },
    ]);
    expect(plan.expenses).toEqual([
      {
        id: 'id-4',
        userId: 'user-1',
        amount: 770,
        category: 'food',
        memo: 'スーパーA: 米',
        date: '2026-11-19',
        createdAt: context.now,
        updatedAt: context.now,
        deviceId: 'mcp:dcr-claude',
        receiptId: 'id-1',
      },
      {
        id: 'id-5',
        userId: 'user-1',
        amount: 330,
        category: 'daily-goods',
        memo: 'スーパーA: ティッシュ',
        date: '2026-11-19',
        createdAt: context.now,
        updatedAt: context.now,
        deviceId: 'mcp:dcr-claude',
        receiptId: 'id-1',
      },
    ]);
    expect(plan.itemsTotal).toBe(1000);
    expect(plan.difference).toBe(100);
  });

  it('明細がなければ明細の行は作らず、差は0とする', () => {
    const plan = planReceiptRecording(
      { storeName: '店', purchasedAt: '2026-11-19', totalAmount: 500, category: 'food' },
      { ...context, newId: ids() }
    );

    expect(plan.items).toEqual([]);
    expect(plan.expenses).toHaveLength(1);
    expect(plan.receipt.taxAmount).toBeNull();
    expect(plan.receipt.paymentMethod).toBeNull();
    expect(plan.itemsTotal).toBeNull();
    expect(plan.difference).toBe(0);
  });
});
