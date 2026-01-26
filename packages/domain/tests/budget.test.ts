import { describe, it, expect } from 'vitest';
import {
  calculateRemaining,
  getPreviousMonth,
  isFirstDayOfMonth,
  isWithinBudget,
  shouldShowCelebration,
  type Expense,
} from '../src/budget';

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

describe('getPreviousMonth', () => {
  it('通常の月の前月を返す', () => {
    const date = new Date(2025, 5, 15); // 2025年6月15日
    expect(getPreviousMonth(date)).toBe('2025-05');
  });

  it('1月の場合は前年の12月を返す', () => {
    const date = new Date(2025, 0, 1); // 2025年1月1日
    expect(getPreviousMonth(date)).toBe('2024-12');
  });

  it('3月の前月を正しく返す', () => {
    const date = new Date(2025, 2, 10); // 2025年3月10日
    expect(getPreviousMonth(date)).toBe('2025-02');
  });
});

describe('isFirstDayOfMonth', () => {
  it('1日の場合はtrueを返す', () => {
    const date = new Date(2025, 5, 1); // 2025年6月1日
    expect(isFirstDayOfMonth(date)).toBe(true);
  });

  it('1日以外の場合はfalseを返す', () => {
    const date = new Date(2025, 5, 2); // 2025年6月2日
    expect(isFirstDayOfMonth(date)).toBe(false);
  });

  it('月末日の場合はfalseを返す', () => {
    const date = new Date(2025, 5, 30); // 2025年6月30日
    expect(isFirstDayOfMonth(date)).toBe(false);
  });
});

describe('isWithinBudget', () => {
  it('支出が予算以下の場合はtrueを返す', () => {
    const budget = 100000;
    const expenses: Expense[] = [{ amount: 50000 }];
    expect(isWithinBudget(budget, expenses)).toBe(true);
  });

  it('支出が予算と同額の場合はtrueを返す', () => {
    const budget = 100000;
    const expenses: Expense[] = [{ amount: 100000 }];
    expect(isWithinBudget(budget, expenses)).toBe(true);
  });

  it('支出が予算を超えた場合はfalseを返す', () => {
    const budget = 100000;
    const expenses: Expense[] = [{ amount: 150000 }];
    expect(isWithinBudget(budget, expenses)).toBe(false);
  });

  it('支出がない場合はtrueを返す', () => {
    expect(isWithinBudget(100000, [])).toBe(true);
  });
});

describe('shouldShowCelebration', () => {
  it('月初日で予算内の場合はtrueを返す', () => {
    const date = new Date(2025, 5, 1); // 2025年6月1日
    const budget = 100000;
    const expenses: Expense[] = [{ amount: 80000 }];
    expect(shouldShowCelebration(budget, expenses, date)).toBe(true);
  });

  it('月初日でも予算超過の場合はfalseを返す', () => {
    const date = new Date(2025, 5, 1); // 2025年6月1日
    const budget = 100000;
    const expenses: Expense[] = [{ amount: 150000 }];
    expect(shouldShowCelebration(budget, expenses, date)).toBe(false);
  });

  it('月初日以外の場合はfalseを返す', () => {
    const date = new Date(2025, 5, 15); // 2025年6月15日
    const budget = 100000;
    const expenses: Expense[] = [{ amount: 80000 }];
    expect(shouldShowCelebration(budget, expenses, date)).toBe(false);
  });

  it('支出がゼロで予算内の場合はtrueを返す', () => {
    const date = new Date(2025, 5, 1); // 2025年6月1日
    expect(shouldShowCelebration(100000, [], date)).toBe(true);
  });

  it('残額がちょうど0円の場合はtrueを返す', () => {
    const date = new Date(2025, 5, 1); // 2025年6月1日
    const budget = 100000;
    const expenses: Expense[] = [{ amount: 100000 }];
    expect(shouldShowCelebration(budget, expenses, date)).toBe(true);
  });
});
