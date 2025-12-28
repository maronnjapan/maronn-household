import { describe, it, expect } from 'vitest';
import { calculateRemaining } from '@maronn/domain';

describe('calculateRemaining', () => {
  it('予算から支出合計を引いた残額を返す', () => {
    const budget = 100000;
    const expenses = [{ amount: 3000 }, { amount: 5000 }];

    expect(calculateRemaining(budget, expenses)).toBe(92000);
  });

  it('支出がない場合は予算全額を返す', () => {
    expect(calculateRemaining(100000, [])).toBe(100000);
  });

  it('支出が予算を超えた場合は負の値を返す', () => {
    const budget = 10000;
    const expenses = [{ amount: 15000 }];

    expect(calculateRemaining(budget, expenses)).toBe(-5000);
  });

  it('複数の支出を正しく合計する', () => {
    const budget = 50000;
    const expenses = [
      { amount: 1000 },
      { amount: 2000 },
      { amount: 3000 },
      { amount: 4000 },
    ];

    expect(calculateRemaining(budget, expenses)).toBe(40000);
  });

  it('0円の支出も正しく処理する', () => {
    const budget = 30000;
    const expenses = [{ amount: 0 }, { amount: 5000 }, { amount: 0 }];

    expect(calculateRemaining(budget, expenses)).toBe(25000);
  });
});
