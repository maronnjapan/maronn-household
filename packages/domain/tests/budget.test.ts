import { describe, it, expect } from 'vitest';
import { calculateRemaining, type Expense } from '../src/budget';

describe('calculateRemaining', () => {
  it('予算から支出合計を引いた残額を返す', () => {
    const budget = 100000;
    const expenses: Expense[] = [
      { amount: 3000 },
      { amount: 5000 },
    ];

    expect(calculateRemaining(budget, expenses)).toBe(92000);
  });

  it('支出がない場合は予算全額を返す', () => {
    expect(calculateRemaining(100000, [])).toBe(100000);
  });

  it('支出が予算を超えた場合は負の値を返す', () => {
    const budget = 10000;
    const expenses: Expense[] = [{ amount: 15000 }];

    expect(calculateRemaining(budget, expenses)).toBe(-5000);
  });

  it('複数の支出を正しく合計する', () => {
    const budget = 50000;
    const expenses: Expense[] = [
      { amount: 1000 },
      { amount: 2500 },
      { amount: 3700 },
      { amount: 800 },
    ];

    expect(calculateRemaining(budget, expenses)).toBe(42000);
  });

  it('0円の予算でも正しく計算する', () => {
    const budget = 0;
    const expenses: Expense[] = [{ amount: 1000 }];

    expect(calculateRemaining(budget, expenses)).toBe(-1000);
  });
});
