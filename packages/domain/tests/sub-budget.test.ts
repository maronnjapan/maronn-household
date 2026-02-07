import { describe, it, expect } from 'vitest';
import {
  getNextMonth,
  getMonthRange,
  getEffectiveMonthlyAmount,
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

describe('getMonthRange', () => {
  it('同じ月の場合は空配列を返す', () => {
    expect(getMonthRange('2025-06', '2025-06')).toEqual([]);
  });

  it('連続する月の範囲を返す', () => {
    expect(getMonthRange('2025-01', '2025-04')).toEqual([
      '2025-01', '2025-02', '2025-03',
    ]);
  });

  it('年をまたぐ範囲を返す', () => {
    expect(getMonthRange('2025-11', '2026-02')).toEqual([
      '2025-11', '2025-12', '2026-01',
    ]);
  });

  it('1ヶ月の範囲を返す', () => {
    expect(getMonthRange('2025-06', '2025-07')).toEqual(['2025-06']);
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

describe('calculateSubBudgetCarryover', () => {
  it('開始月と対象月が同じ場合は0を返す', () => {
    const result = calculateSubBudgetCarryover(
      '2025-06', '2025-06', [], 10000, new Map()
    );
    expect(result).toBe(0);
  });

  it('支出がない場合は月額予算の累計を返す', () => {
    // 3ヶ月分（1月〜3月）で対象は4月、月額10000円
    const result = calculateSubBudgetCarryover(
      '2025-01', '2025-04', [], 10000, new Map()
    );
    expect(result).toBe(30000); // 10000 * 3
  });

  it('予算以下の支出がある場合は余りを繰り越す', () => {
    // 1万円/月で5000円しか使わない = 5000円余り
    const expenses = new Map([
      ['2025-01', 5000],
    ]);
    const result = calculateSubBudgetCarryover(
      '2025-01', '2025-02', [], 10000, expenses
    );
    expect(result).toBe(5000);
  });

  it('複数月の繰り越しが累計される', () => {
    // 1月: 10000 - 5000 = +5000
    // 2月: 10000 - 8000 = +2000
    // 3月: 10000 - 12000 = -2000
    // 合計: +5000
    const expenses = new Map([
      ['2025-01', 5000],
      ['2025-02', 8000],
      ['2025-03', 12000],
    ]);
    const result = calculateSubBudgetCarryover(
      '2025-01', '2025-04', [], 10000, expenses
    );
    expect(result).toBe(5000);
  });

  it('予算変更があっても過去の月は旧予算で計算される', () => {
    // 1月〜3月: 10000円/月
    // 4月〜: 20000円/月
    const monthlyAmounts: SubBudgetMonthlyAmount[] = [
      { month: '2025-01', amount: 10000 },
      { month: '2025-04', amount: 20000 },
    ];
    // 1月: 10000 - 5000 = +5000
    // 2月: 10000 - 10000 = 0
    // 3月: 10000 - 8000 = +2000
    // 4月: 20000 - 15000 = +5000
    // 繰り越し合計（5月の時点）: +12000
    const expenses = new Map([
      ['2025-01', 5000],
      ['2025-02', 10000],
      ['2025-03', 8000],
      ['2025-04', 15000],
    ]);
    const result = calculateSubBudgetCarryover(
      '2025-01', '2025-05', monthlyAmounts, 10000, expenses
    );
    expect(result).toBe(12000);
  });

  it('超過した月はマイナスの繰り越しになる', () => {
    const expenses = new Map([
      ['2025-01', 15000],
    ]);
    const result = calculateSubBudgetCarryover(
      '2025-01', '2025-02', [], 10000, expenses
    );
    expect(result).toBe(-5000);
  });

  it('支出がない月は月額全額が繰り越される', () => {
    // 1月: 支出なし = +10000
    // 2月: 支出5000 = +5000
    // 繰り越し: +15000
    const expenses = new Map([
      ['2025-02', 5000],
    ]);
    const result = calculateSubBudgetCarryover(
      '2025-01', '2025-03', [], 10000, expenses
    );
    expect(result).toBe(15000);
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
