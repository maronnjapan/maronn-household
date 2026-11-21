import { describe, it, expect } from 'vitest';
import {
  allocateExpenseByCategory,
  distributeTotal,
  formatItemsText,
  itemsTotal,
  normalizeExpenseItems,
  resolveExpenseCategories,
} from '../src/expense-items';

describe('allocateExpenseByCategory', () => {
  it('内訳がなければ支払総額をそのまま会計のカテゴリーに計上する', () => {
    expect(allocateExpenseByCategory({ amount: 1980, category: 'food' })).toEqual([
      { category: 'food', amount: 1980 },
    ]);
  });

  it('会計のカテゴリーもなければ other に計上する', () => {
    expect(allocateExpenseByCategory({ amount: 500, category: null, items: null })).toEqual([
      { category: 'other', amount: 500 },
    ]);
    expect(allocateExpenseByCategory({ amount: 500, items: [] })).toEqual([{ category: 'other', amount: 500 }]);
  });

  it('内訳をカテゴリーごとにまとめ、支払総額を内訳の金額の比率で按分する（内訳の順に並べる）', () => {
    const result = allocateExpenseByCategory({
      amount: 1000,
      items: [
        { name: '牛乳', amount: 300, category: 'food' },
        { name: '洗剤', amount: 400, category: 'daily-goods' },
        { name: 'パン', amount: 300, category: 'food' },
      ],
    });

    expect(result).toEqual([
      { category: 'food', amount: 600 },
      { category: 'daily-goods', amount: 400 },
    ]);
  });

  it('内訳の合計と支払総額の差（消費税・値引き）も比率で配り、合計を支払総額に一致させる', () => {
    const withTax = allocateExpenseByCategory({
      amount: 1100,
      items: [
        { name: '米', amount: 700, category: 'food' },
        { name: 'ティッシュ', amount: 300, category: 'daily-goods' },
      ],
    });
    const withDiscount = allocateExpenseByCategory({
      amount: 900,
      items: [
        { name: '肉', amount: 600, category: 'food' },
        { name: '電池', amount: 400, category: 'daily-goods' },
      ],
    });

    expect(withTax.map((a) => a.amount)).toEqual([770, 330]);
    expect(withDiscount.map((a) => a.amount)).toEqual([540, 360]);
  });

  it('按分の端数は最大剰余法で配り、合計は必ず支払総額になる', () => {
    const result = allocateExpenseByCategory({
      amount: 100,
      items: [
        { name: 'a', amount: 1, category: 'food' },
        { name: 'b', amount: 1, category: 'daily-goods' },
        { name: 'c', amount: 1, category: 'other' },
      ],
    });

    expect(result.reduce((sum, a) => sum + a.amount, 0)).toBe(100);
    expect(result.map((a) => a.amount)).toEqual([34, 33, 33]);
  });

  it('カテゴリーのない内訳は会計のカテゴリー、それもなければ other に計上する', () => {
    const withExpenseCategory = allocateExpenseByCategory({
      amount: 600,
      category: 'food',
      items: [
        { name: 'おにぎり', amount: 300 },
        { name: '洗剤', amount: 300, category: 'daily-goods' },
      ],
    });
    const withoutCategory = allocateExpenseByCategory({ amount: 300, items: [{ name: 'なにか', amount: 300 }] });

    expect(withExpenseCategory).toEqual([
      { category: 'food', amount: 300 },
      { category: 'daily-goods', amount: 300 },
    ]);
    expect(withoutCategory).toEqual([{ category: 'other', amount: 300 }]);
  });

  it('按分で0円になったカテゴリーは含めない', () => {
    const result = allocateExpenseByCategory({
      amount: 500,
      items: [
        { name: '弁当', amount: 500, category: 'food' },
        { name: 'クーポン', amount: 0, category: 'other' },
      ],
    });

    expect(result).toEqual([{ category: 'food', amount: 500 }]);
  });

  it('内訳の金額がすべて0（品名だけの内訳）なら、内訳がないときと同じく会計のカテゴリーに計上する', () => {
    const result = allocateExpenseByCategory({
      amount: 3000,
      category: 'food',
      items: [
        { name: '洗剤', amount: 0, category: 'daily-goods' },
        { name: '米', amount: 0 },
      ],
    });

    expect(result).toEqual([{ category: 'food', amount: 3000 }]);
  });
});

describe('distributeTotal', () => {
  it('重みの比率で整数に分け、合計を total に一致させる', () => {
    expect(distributeTotal(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(distributeTotal(1100, [700, 300])).toEqual([770, 330]);
  });

  it('重みの合計が0なら先頭に全額を割り当てる', () => {
    expect(distributeTotal(300, [0, 0])).toEqual([300, 0]);
  });

  it('大きな額でも浮動小数の誤差なく、正確な比率で分ける（合計は total）', () => {
    // 浮動小数で計算すると [850385794563, 30791529816] になる（端数の大小を取り違える）
    expect(distributeTotal(881_177_324_379, [863_064_038, 31_250_595])).toEqual([850_385_794_562, 30_791_529_817]);
  });

  it('total が小数（以前の端末で保存された金額）なら丸めてから分ける', () => {
    expect(distributeTotal(100.4, [1, 1])).toEqual([50, 50]);
  });
});

describe('itemsTotal', () => {
  it('内訳の金額の合計（内訳がなければ0）', () => {
    expect(itemsTotal([{ amount: 198 }, { amount: 398 }])).toBe(596);
    expect(itemsTotal(undefined)).toBe(0);
    expect(itemsTotal(null)).toBe(0);
  });
});

describe('normalizeExpenseItems', () => {
  it('品名の前後の空白を除き、指定のない任意の項目は持たない', () => {
    expect(
      normalizeExpenseItems([
        { name: '  牛乳 ', amount: 198, category: 'food', quantity: undefined },
        { name: '洗剤', amount: 398, quantity: 2, category: undefined },
      ])
    ).toEqual([
      { name: '牛乳', amount: 198, category: 'food' },
      { name: '洗剤', amount: 398, quantity: 2 },
    ]);
  });

  it('品名の改行・連続した空白は1つの空白にする（CSV の1セルに収めるため）', () => {
    expect(normalizeExpenseItems([{ name: 'お茶\r\n 2本', amount: 300 }])).toEqual([{ name: 'お茶 2本', amount: 300 }]);
  });

  it('空のカテゴリーは指定なしとみなす', () => {
    expect(normalizeExpenseItems([{ name: '牛乳', amount: 198, category: '' }])).toEqual([
      { name: '牛乳', amount: 198 },
    ]);
  });

  it('内訳がなければ undefined', () => {
    expect(normalizeExpenseItems([])).toBeUndefined();
    expect(normalizeExpenseItems(undefined)).toBeUndefined();
    expect(normalizeExpenseItems(null)).toBeUndefined();
  });
});

describe('formatItemsText', () => {
  it('内訳を1行の文字列にする（改行は使わない）', () => {
    expect(
      formatItemsText([
        { name: '牛乳', amount: 198, category: 'food' },
        { name: '洗剤', amount: 1398, quantity: 2 },
      ])
    ).toBe('牛乳 ¥198 / 洗剤 ×2 ¥1,398');
  });

  it('品名がなければカテゴリー名（分からなければ「内訳」）で表す', () => {
    const labelOf = (value: string) => (value === 'food' ? '食費' : undefined);

    expect(
      formatItemsText(
        [
          { name: '', amount: 1200, category: 'food' },
          { name: '', amount: 800, category: 'unknown' },
          { name: '', amount: 100 },
        ],
        labelOf
      )
    ).toBe('食費 ¥1,200 / 内訳 ¥800 / 内訳 ¥100');
  });

  it('金額が0の内訳は品名だけを出す', () => {
    expect(formatItemsText([{ name: '牛乳', amount: 0 }, { name: '卵', amount: 300 }])).toBe('牛乳 / 卵 ¥300');
  });

  it('品名もカテゴリーもない内訳は、会計のカテゴリー名で表す', () => {
    const labelOf = (value: string) => (value === 'food' ? '食費' : undefined);

    expect(formatItemsText([{ name: '', amount: 2800 }], labelOf, 'food')).toBe('食費 ¥2,800');
  });

  it('品名の中の改行は空白にする', () => {
    expect(formatItemsText([{ name: 'お茶\n2本', amount: 300 }])).toBe('お茶 2本 ¥300');
  });

  it('内訳がなければ空文字', () => {
    expect(formatItemsText(undefined)).toBe('');
    expect(formatItemsText([])).toBe('');
  });
});

describe('resolveExpenseCategories', () => {
  it('カテゴリーのない内訳に会計のカテゴリーを入れる（後から会計のカテゴリーを変えても按分が動かないように）', () => {
    const result = resolveExpenseCategories({
      amount: 600,
      category: 'food',
      items: [
        { name: 'おにぎり', amount: 300 },
        { name: '洗剤', amount: 300, category: 'daily-goods' },
      ],
    });

    expect(result).toEqual({
      category: 'food',
      items: [
        { name: 'おにぎり', amount: 300, category: 'food' },
        { name: '洗剤', amount: 300, category: 'daily-goods' },
      ],
    });
  });

  it('会計のカテゴリーがなければ、按分額が最大のカテゴリー（主なカテゴリー）を会計のカテゴリーにする', () => {
    const result = resolveExpenseCategories({
      amount: 1100,
      items: [
        { name: 'ティッシュ', amount: 300, category: 'daily-goods' },
        { name: '米', amount: 700, category: 'food' },
      ],
    });

    expect(result.category).toBe('food');
  });

  it('会計のカテゴリーもない内訳は other にし、それが最大なら会計のカテゴリーも other にする', () => {
    const result = resolveExpenseCategories({
      amount: 3280,
      items: [
        { name: 'シャンプー', amount: 480, category: 'daily-goods' },
        { name: '', amount: 2800 },
      ],
    });

    expect(result).toEqual({
      category: 'other',
      items: [
        { name: 'シャンプー', amount: 480, category: 'daily-goods' },
        { name: '', amount: 2800, category: 'other' },
      ],
    });
  });

  it('按分額が同じなら内訳に先に出てきたカテゴリーを主なカテゴリーにする', () => {
    expect(
      resolveExpenseCategories({
        amount: 200,
        items: [
          { name: 'a', amount: 100, category: 'daily-goods' },
          { name: 'b', amount: 100, category: 'food' },
        ],
      }).category
    ).toBe('daily-goods');
  });

  it('内訳がなければ会計のカテゴリーをそのまま返す（なければ undefined のまま）', () => {
    expect(resolveExpenseCategories({ amount: 500, category: 'food' })).toEqual({ category: 'food', items: undefined });
    expect(resolveExpenseCategories({ amount: 500, items: null })).toEqual({ category: undefined, items: null });
  });
});
