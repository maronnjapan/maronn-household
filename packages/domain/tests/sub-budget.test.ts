import { describe, it, expect } from 'vitest';
import {
  getNextMonth,
  monthsBetween,
  getEffectiveMonthlyAmount,
  calculateTotalAllocated,
  calculateSubBudgetCarryover,
  calculateSubBudgetAvailable,
  calculateSubBudgetRemaining,
  type SubBudgetMonthlyAmount,
} from '../src/sub-budget';

describe('getNextMonth', () => {
  it('通常の月の次月を返す', () => {
    expect(getNextMonth('2025-01')).toBe('2025-02');
    expect(getNextMonth('2025-06')).toBe('2025-07');
    expect(getNextMonth('2025-11')).toBe('2025-12');
  });

  it('12月の場合は翌年の1月を返す', () => {
    expect(getNextMonth('2025-12')).toBe('2026-01');
  });

  it('1桁の月はゼロ埋めされる', () => {
    expect(getNextMonth('2025-01')).toBe('2025-02');
    expect(getNextMonth('2025-09')).toBe('2025-10');
  });
});

describe('monthsBetween', () => {
  it('同じ月の場合は0を返す', () => {
    expect(monthsBetween('2025-06', '2025-06')).toBe(0);
  });

  it('連続する月の差を返す', () => {
    expect(monthsBetween('2025-01', '2025-04')).toBe(3);
  });

  it('年をまたぐ月数を返す', () => {
    expect(monthsBetween('2025-11', '2026-02')).toBe(3);
  });

  it('1ヶ月の差を返す', () => {
    expect(monthsBetween('2025-06', '2025-07')).toBe(1);
  });

  it('toがfromより前の場合は0を返す', () => {
    expect(monthsBetween('2025-06', '2025-03')).toBe(0);
  });
});

describe('getEffectiveMonthlyAmount', () => {
  it('月別設定がない場合はデフォルト値を返す', () => {
    expect(getEffectiveMonthlyAmount('2025-06', [], 10000)).toBe(10000);
  });

  it('その月の設定がある場合はその値を返す', () => {
    const amounts: SubBudgetMonthlyAmount[] = [
      { month: '2025-06', amount: 15000 },
    ];
    expect(getEffectiveMonthlyAmount('2025-06', amounts, 10000)).toBe(15000);
  });

  it('過去の設定が引き継がれる', () => {
    const amounts: SubBudgetMonthlyAmount[] = [
      { month: '2025-01', amount: 10000 },
      { month: '2025-04', amount: 20000 },
    ];
    // 2月は1月の設定が引き継がれる
    expect(getEffectiveMonthlyAmount('2025-02', amounts, 5000)).toBe(10000);
    // 5月は4月の設定が引き継がれる
    expect(getEffectiveMonthlyAmount('2025-05', amounts, 5000)).toBe(20000);
  });

  it('対象月より後の設定は無視される', () => {
    const amounts: SubBudgetMonthlyAmount[] = [
      { month: '2025-01', amount: 10000 },
      { month: '2025-06', amount: 20000 },
    ];
    expect(getEffectiveMonthlyAmount('2025-03', amounts, 5000)).toBe(10000);
  });

  it('対象月より前の設定がない場合はデフォルト値を返す', () => {
    const amounts: SubBudgetMonthlyAmount[] = [
      { month: '2025-06', amount: 20000 },
    ];
    expect(getEffectiveMonthlyAmount('2025-03', amounts, 5000)).toBe(5000);
  });
});

describe('calculateTotalAllocated', () => {
  it('開始月と終了月が同じ場合は0を返す', () => {
    expect(calculateTotalAllocated('2025-06', '2025-06', [], 10000)).toBe(0);
  });

  it('レート変更なしの場合はデフォルト×月数を返す', () => {
    // 3ヶ月分（1月〜3月）、月額10000円
    expect(calculateTotalAllocated('2025-01', '2025-04', [], 10000)).toBe(30000);
  });

  it('1ヶ月分を返す', () => {
    expect(calculateTotalAllocated('2025-06', '2025-07', [], 10000)).toBe(10000);
  });

  it('レート変更がある場合は区間ごとに計算する', () => {
    // 1月〜3月: 10000円/月 (3ヶ月 = 30000)
    // 4月〜4月: 20000円/月 (1ヶ月 = 20000)
    // 合計: 50000
    const monthlyAmounts: SubBudgetMonthlyAmount[] = [
      { month: '2025-01', amount: 10000 },
      { month: '2025-04', amount: 20000 },
    ];
    expect(calculateTotalAllocated('2025-01', '2025-05', monthlyAmounts, 5000)).toBe(50000);
  });

  it('開始月より前のレート設定が適用される', () => {
    // 開始月(3月)より前に1月の設定がある → 3月は10000円が適用
    const monthlyAmounts: SubBudgetMonthlyAmount[] = [
      { month: '2025-01', amount: 10000 },
    ];
    // 3月〜5月: 10000 × 3 = 30000
    expect(calculateTotalAllocated('2025-03', '2025-06', monthlyAmounts, 5000)).toBe(30000);
  });

  it('年をまたぐ期間でも正しく計算する', () => {
    // 11月〜1月: 3ヶ月 × 10000 = 30000
    expect(calculateTotalAllocated('2025-11', '2026-02', [], 10000)).toBe(30000);
  });

  it('複数のレート変更がある場合', () => {
    // 1月: 5000 (1ヶ月 = 5000)
    // 2月〜3月: 10000 (2ヶ月 = 20000)
    // 4月〜5月: 20000 (2ヶ月 = 40000)
    // 合計: 65000
    const monthlyAmounts: SubBudgetMonthlyAmount[] = [
      { month: '2025-01', amount: 5000 },
      { month: '2025-02', amount: 10000 },
      { month: '2025-04', amount: 20000 },
    ];
    expect(calculateTotalAllocated('2025-01', '2025-06', monthlyAmounts, 0)).toBe(65000);
  });
});

describe('calculateSubBudgetCarryover', () => {
  it('予算合計と支出合計の差を返す', () => {
    expect(calculateSubBudgetCarryover(30000, 25000)).toBe(5000);
  });

  it('支出が予算を超えた場合はマイナスを返す', () => {
    expect(calculateSubBudgetCarryover(10000, 15000)).toBe(-5000);
  });

  it('支出がない場合は予算合計をそのまま返す', () => {
    expect(calculateSubBudgetCarryover(30000, 0)).toBe(30000);
  });

  it('予算も支出も0の場合は0を返す', () => {
    expect(calculateSubBudgetCarryover(0, 0)).toBe(0);
  });
});

describe('calculateSubBudgetAvailable', () => {
  it('月額予算と繰り越しの合計を返す', () => {
    expect(calculateSubBudgetAvailable(10000, 5000)).toBe(15000);
  });

  it('繰り越しがマイナスの場合は月額予算から減算される', () => {
    expect(calculateSubBudgetAvailable(10000, -3000)).toBe(7000);
  });

  it('繰り越しが0の場合は月額予算を返す', () => {
    expect(calculateSubBudgetAvailable(10000, 0)).toBe(10000);
  });
});

describe('calculateSubBudgetRemaining', () => {
  it('利用可能額から支出を引いた残額を返す', () => {
    expect(calculateSubBudgetRemaining(15000, 3000)).toBe(12000);
  });

  it('支出が利用可能額を超えた場合はマイナスを返す', () => {
    expect(calculateSubBudgetRemaining(10000, 15000)).toBe(-5000);
  });

  it('支出が0の場合は利用可能額をそのまま返す', () => {
    expect(calculateSubBudgetRemaining(15000, 0)).toBe(15000);
  });
});
