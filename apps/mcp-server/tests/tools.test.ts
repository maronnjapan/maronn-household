/**
 * MCPツールのユニットテスト
 *
 * D1データベースをモックして各ツール関数の動作を検証する。
 * 実際のDB操作はdrizzle-ormを通すため、ここではドメインロジック部分の
 * 入力検証やビジネスルールをテストする。
 */

import { describe, it, expect } from 'vitest';

describe('add-expense validation', () => {
  it('金額が0以下の場合はエラーになる', async () => {
    const { addExpense } = await import('../src/tools/add-expense');

    const mockDb = {} as D1Database;
    await expect(
      addExpense(mockDb, 'user-1', { amount: 0 }),
    ).rejects.toThrow('金額は正の数である必要があります');

    await expect(
      addExpense(mockDb, 'user-1', { amount: -100 }),
    ).rejects.toThrow('金額は正の数である必要があります');
  });
});

describe('update-budget validation', () => {
  it('予算額が負の場合はエラーになる', async () => {
    const { updateBudget } = await import('../src/tools/update-budget');
    const mockDb = {} as D1Database;

    await expect(
      updateBudget(mockDb, 'user-1', { month: '2026-03', amount: -1 }),
    ).rejects.toThrow('予算額は0以上である必要があります');
  });

  it('月のフォーマットが不正な場合はエラーになる', async () => {
    const { updateBudget } = await import('../src/tools/update-budget');
    const mockDb = {} as D1Database;

    await expect(
      updateBudget(mockDb, 'user-1', { month: '2026/03', amount: 100000 }),
    ).rejects.toThrow('月はYYYY-MM形式で指定してください');

    await expect(
      updateBudget(mockDb, 'user-1', { month: 'March', amount: 100000 }),
    ).rejects.toThrow('月はYYYY-MM形式で指定してください');
  });
});
