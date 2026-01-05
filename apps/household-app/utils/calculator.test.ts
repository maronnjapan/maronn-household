import { describe, it, expect } from 'vitest';
import { evaluateExpression } from './calculator';

describe('evaluateExpression', () => {
  describe('基本的な四則演算', () => {
    it('足し算を計算できる', () => {
      expect(evaluateExpression('100+50')).toBe(150);
      expect(evaluateExpression('1+2+3')).toBe(6);
    });

    it('引き算を計算できる', () => {
      expect(evaluateExpression('100-50')).toBe(50);
      expect(evaluateExpression('100-30-20')).toBe(50);
    });

    it('掛け算を計算できる', () => {
      expect(evaluateExpression('50×2')).toBe(100);
      expect(evaluateExpression('50*2')).toBe(100);
      expect(evaluateExpression('10×5×2')).toBe(100);
    });

    it('割り算を計算できる', () => {
      expect(evaluateExpression('100÷2')).toBe(50);
      expect(evaluateExpression('100/2')).toBe(50);
      expect(evaluateExpression('100÷5÷2')).toBe(10);
    });
  });

  describe('演算子の優先順位', () => {
    it('掛け算・割り算を優先して計算する', () => {
      expect(evaluateExpression('100+50×2')).toBe(200);
      expect(evaluateExpression('100-50÷2')).toBe(75);
      expect(evaluateExpression('10+5×4-2')).toBe(28);
    });
  });

  describe('括弧', () => {
    it('括弧内を優先して計算する', () => {
      expect(evaluateExpression('(100+50)×2')).toBe(300);
      expect(evaluateExpression('100÷(10-5)')).toBe(20);
      expect(evaluateExpression('(10+5)×(4-2)')).toBe(30);
    });

    it('ネストした括弧を計算できる', () => {
      expect(evaluateExpression('((10+5)×2)÷3')).toBe(10);
    });
  });

  describe('小数点', () => {
    it('小数点を含む計算ができる', () => {
      expect(evaluateExpression('10.5+5.5')).toBe(16);
      expect(evaluateExpression('10.5×2')).toBe(21);
    });

    it('結果を整数に丸める', () => {
      expect(evaluateExpression('10÷3')).toBe(3);
      expect(evaluateExpression('10÷3×3')).toBe(10);
    });
  });

  describe('負の数', () => {
    it('負の数を計算できる', () => {
      expect(evaluateExpression('-10+5')).toBe(-5);
      expect(evaluateExpression('10+-5')).toBe(5);
    });
  });

  describe('スペース', () => {
    it('スペースを無視して計算する', () => {
      expect(evaluateExpression('100 + 50 × 2')).toBe(200);
      expect(evaluateExpression(' 100 + 50 ')).toBe(150);
    });
  });

  describe('エラーケース', () => {
    it('空文字列はnullを返す', () => {
      expect(evaluateExpression('')).toBe(null);
      expect(evaluateExpression('   ')).toBe(null);
    });

    it('不正な文字を含む場合はnullを返す', () => {
      expect(evaluateExpression('100+abc')).toBe(null);
      expect(evaluateExpression('100$50')).toBe(null);
    });

    it('0除算の場合はnullを返す', () => {
      expect(evaluateExpression('100÷0')).toBe(null);
    });

    it('不正な構文の場合はnullを返す', () => {
      expect(evaluateExpression('++100')).toBe(null);
      expect(evaluateExpression('100++')).toBe(null);
    });
  });

  describe('実際のユースケース', () => {
    it('レシートの合計を計算できる', () => {
      expect(evaluateExpression('1580+298+450')).toBe(2328);
    });

    it('割り勘を計算できる', () => {
      expect(evaluateExpression('5000÷3')).toBe(1667);
    });

    it('複雑な計算ができる', () => {
      expect(evaluateExpression('(1500+2000+800)÷4')).toBe(1075);
    });
  });
});
