import { describe, it, expect } from 'vitest';

describe('Sample Test Suite', () => {
  it('基本的な算術演算が動作する', () => {
    expect(1 + 1).toBe(2);
  });

  it('文字列の連結が動作する', () => {
    expect('Hello' + ' ' + 'World').toBe('Hello World');
  });

  it('配列操作が動作する', () => {
    const arr = [1, 2, 3];
    expect(arr.length).toBe(3);
    expect(arr.includes(2)).toBe(true);
  });

  it('オブジェクトの比較が動作する', () => {
    const obj = { name: 'Test', value: 42 };
    expect(obj).toEqual({ name: 'Test', value: 42 });
  });
});

// 予算に関する簡単な計算のテスト
describe('Budget Calculations', () => {
  const calculateTotal = (expenses: number[]): number => {
    return expenses.reduce((sum, expense) => sum + expense, 0);
  };

  it('支出の合計を計算できる', () => {
    const expenses = [1000, 2000, 3000];
    expect(calculateTotal(expenses)).toBe(6000);
  });

  it('空の配列の場合は0を返す', () => {
    expect(calculateTotal([])).toBe(0);
  });

  it('単一の支出を正しく処理する', () => {
    expect(calculateTotal([5000])).toBe(5000);
  });
});
