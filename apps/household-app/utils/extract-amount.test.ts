import { describe, it, expect } from 'vitest';
import { extractAmount } from './extract-amount';

describe('extractAmount', () => {
  describe('円表記', () => {
    it('基本的な円表記から金額を抽出', () => {
      expect(extractAmount('350円')).toBe(350);
      expect(extractAmount('1280円')).toBe(1280);
    });

    it('カンマ区切りの円表記から金額を抽出', () => {
      expect(extractAmount('1,280円')).toBe(1280);
      expect(extractAmount('10,000円')).toBe(10000);
      expect(extractAmount('1,234,567円')).toBe(1234567);
    });

    it('前後にテキストがある場合も抽出', () => {
      expect(extractAmount('本日の支払いは 350円 です')).toBe(350);
      expect(extractAmount('PayPay 1,280円 でお支払い')).toBe(1280);
    });

    it('スペースが入っていても抽出', () => {
      expect(extractAmount('350 円')).toBe(350);
      expect(extractAmount('1,280 円')).toBe(1280);
    });
  });

  describe('円記号表記', () => {
    it('¥記号から金額を抽出', () => {
      expect(extractAmount('¥1,280')).toBe(1280);
      expect(extractAmount('¥350')).toBe(350);
    });

    it('全角円記号から金額を抽出', () => {
      expect(extractAmount('￥1,280')).toBe(1280);
      expect(extractAmount('￥350')).toBe(350);
    });

    it('円記号とスペースがあっても抽出', () => {
      expect(extractAmount('¥ 1,280')).toBe(1280);
      expect(extractAmount('￥ 350')).toBe(350);
    });

    it('前後にテキストがある場合も抽出', () => {
      expect(extractAmount('合計 ¥1,280 でした')).toBe(1280);
    });
  });

  describe('キーワード付き表記', () => {
    it('合計から金額を抽出', () => {
      expect(extractAmount('合計: 1,500')).toBe(1500);
      expect(extractAmount('合計 1,500')).toBe(1500);
      expect(extractAmount('合計:1,500')).toBe(1500);
    });

    it('全角コロンでも抽出', () => {
      expect(extractAmount('合計：1,500')).toBe(1500);
    });

    it('金額キーワードから抽出', () => {
      expect(extractAmount('金額: 2,000')).toBe(2000);
    });

    it('支払キーワードから抽出', () => {
      expect(extractAmount('支払: 3,000')).toBe(3000);
      expect(extractAmount('お支払い: 3,500')).toBe(3500);
    });

    it('決済キーワードから抽出', () => {
      expect(extractAmount('決済: 4,000')).toBe(4000);
    });
  });

  describe('実際の通知例', () => {
    it('PayPay通知から抽出', () => {
      expect(extractAmount('PayPay 350円 でお支払いしました')).toBe(350);
      expect(extractAmount('PayPayで¥1,280のお支払いが完了しました')).toBe(1280);
    });

    it('クレジットカード通知から抽出', () => {
      expect(extractAmount('ご利用金額: 5,000円')).toBe(5000);
      expect(extractAmount('お支払い金額 ¥12,800')).toBe(12800);
    });

    it('レシート風テキストから抽出', () => {
      expect(extractAmount('合計金額: 1,480円')).toBe(1480);
      expect(extractAmount('お会計 ¥2,350')).toBe(2350);
    });
  });

  describe('複数の金額が含まれる場合', () => {
    it('最大の金額を返す', () => {
      expect(extractAmount('小計 500円 + 税 50円 = 合計 550円')).toBe(550);
      expect(extractAmount('100円割引で元値1,000円が900円になりました')).toBe(1000);
    });
  });

  describe('エラーケース', () => {
    it('金額が含まれていない場合はnullを返す', () => {
      expect(extractAmount('こんにちは')).toBeNull();
      expect(extractAmount('テストメッセージ')).toBeNull();
      expect(extractAmount('')).toBeNull();
    });

    it('null/undefinedの場合はnullを返す', () => {
      expect(extractAmount(null as unknown as string)).toBeNull();
      expect(extractAmount(undefined as unknown as string)).toBeNull();
    });

    it('数字だけの場合はnullを返す（単位がない）', () => {
      expect(extractAmount('1280')).toBeNull();
      expect(extractAmount('350')).toBeNull();
    });

    it('不正な形式の場合はnullを返す', () => {
      expect(extractAmount('円350')).toBeNull(); // 順序が逆
      expect(extractAmount('¥¥1000')).toBeNull(); // 記号が重複
    });

    it('範囲外の金額はnullを返す', () => {
      expect(extractAmount('¥0')).toBeNull(); // 0円以下
      expect(extractAmount('¥-100')).toBeNull(); // 負の値
      expect(extractAmount('¥1,000,000,000')).toBeNull(); // 10億円以上
    });
  });

  describe('エッジケース', () => {
    it('1円から抽出できる', () => {
      expect(extractAmount('¥1')).toBe(1);
      expect(extractAmount('1円')).toBe(1);
    });

    it('大きな金額も抽出できる', () => {
      expect(extractAmount('¥999,999,999')).toBe(999999999);
    });

    it('改行が含まれていても抽出', () => {
      expect(extractAmount('合計\n1,500円')).toBe(1500);
      expect(extractAmount('PayPay\n¥350\nでお支払い')).toBe(350);
    });
  });
});
