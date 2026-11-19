import { describe, it, expect } from 'vitest';
import {
  allocateReceiptToExpenses,
  receiptFingerprint,
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

describe('receiptFingerprint', () => {
  it('表記ゆれ（全角・空白・記号）を吸収して同じレシートを同一と判定する', () => {
    const a = receiptFingerprint({
      storeName: 'セブン-イレブン 新宿店',
      purchasedAt: '2026-11-19T12:34',
      totalAmount: 598,
    });
    const b = receiptFingerprint({
      storeName: 'ｾﾌﾞﾝｲﾚﾌﾞﾝ新宿店',
      purchasedAt: '2026-11-19T12:34',
      totalAmount: 598,
    });

    expect(a).toBe(b);
  });

  it('金額や日時が違えば別のレシートとして扱う', () => {
    const base = { storeName: '店', purchasedAt: '2026-11-19T12:34', totalAmount: 598 };

    expect(receiptFingerprint(base)).not.toBe(receiptFingerprint({ ...base, totalAmount: 599 }));
    expect(receiptFingerprint(base)).not.toBe(
      receiptFingerprint({ ...base, purchasedAt: '2026-11-19T12:35' })
    );
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
