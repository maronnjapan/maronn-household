import { describe, it, expect } from 'vitest';
import { createExpense } from '../src/expense';

describe('createExpense', () => {
  it('金額のみ指定して支出を作成できる', () => {
    const expense = createExpense({ amount: 5000 });

    expect(expense.amount).toBe(5000);
    expect(expense.id).toBeTruthy();
    expect(expense.syncStatus).toBe('pending');
    expect(expense.deviceId).toBeTruthy();
    expect(expense.createdAt).toBeTruthy();
    expect(expense.updatedAt).toBe(expense.createdAt);
    expect(expense.date).toBeTruthy();
  });

  it('カテゴリとメモを指定して作成できる', () => {
    const expense = createExpense({
      amount: 3000,
      category: '食費',
      memo: 'スーパーで買い物',
    });

    expect(expense.amount).toBe(3000);
    expect(expense.category).toBe('食費');
    expect(expense.memo).toBe('スーパーで買い物');
  });

  it('日付を指定して作成できる', () => {
    const date = '2024-01-15';
    const expense = createExpense({
      amount: 2000,
      date,
    });

    expect(expense.date).toBe(date);
  });

  it('デバイスIDを指定して作成できる', () => {
    const deviceId = 'test-device-123';
    const expense = createExpense({
      amount: 1000,
      deviceId,
    });

    expect(expense.deviceId).toBe(deviceId);
  });

  it('各支出には一意のIDが付与される', () => {
    const expense1 = createExpense({ amount: 100 });
    const expense2 = createExpense({ amount: 200 });

    expect(expense1.id).not.toBe(expense2.id);
  });

  it('内訳を指定して作成できる（金額は支払総額のまま）', () => {
    const expense = createExpense({
      amount: 3280,
      category: 'food',
      items: [
        { name: ' 牛乳 ', amount: 198 },
        { name: '洗剤', amount: 398, category: 'daily-goods' },
      ],
    });

    expect(expense.amount).toBe(3280);
    expect(expense.category).toBe('food');
    expect(expense.items).toEqual([
      { name: '牛乳', amount: 198, category: 'food' },
      { name: '洗剤', amount: 398, category: 'daily-goods' },
    ]);
  });

  it('内訳があり会計のカテゴリーがなければ、主なカテゴリー（按分額が最大）を会計のカテゴリーにする', () => {
    const expense = createExpense({
      amount: 3280,
      items: [
        { name: 'シャンプー', amount: 480, category: 'daily-goods' },
        { name: '', amount: 2800, category: 'food' },
      ],
    });

    expect(expense.category).toBe('food');
  });

  it('内訳が空なら内訳を持たない', () => {
    expect(createExpense({ amount: 100, items: [] }).items).toBeUndefined();
    expect(createExpense({ amount: 100 }).items).toBeUndefined();
  });
});
