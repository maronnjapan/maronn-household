import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../../src/index';
import { cleanupTestData, createDefaultUser } from '../utils/db';
import { createExpenseFixture } from '../utils/fixtures';

describe('Expenses API', () => {
  beforeEach(async () => {
    // デフォルトユーザーを作成
    await createDefaultUser(env.DB);
  });

  afterEach(async () => {
    // テストデータをクリーンアップ
    await cleanupTestData(env.DB);
  });

  describe('POST /expenses', () => {
    it('新しい支出を作成できる', async () => {
      const expense = createExpenseFixture({
        amount: 5000,
        category: 'food',
        memo: 'ランチ',
      });

      const request = new Request('http://localhost/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(expense),
      });

      const response = await app.fetch(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        created: true,
      });
    });

    it('必須フィールドが欠けている場合は400エラーを返す', async () => {
      const invalidExpense = {
        amount: 5000,
        // id, date, createdAt, updatedAt, deviceId が欠けている
      };

      const request = new Request('http://localhost/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidExpense),
      });

      const response = await app.fetch(request, env);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toHaveProperty('error');
    });

    it('既存の支出を更新できる（updatedAtが新しい場合）', async () => {
      const expense = createExpenseFixture({ amount: 3000 });

      // 最初に作成
      const createRequest = new Request('http://localhost/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(expense),
      });
      await app.fetch(createRequest, env);

      // 同じIDで更新（updatedAtを新しくする）
      const updatedExpense = {
        ...expense,
        amount: 5000,
        updatedAt: new Date(Date.now() + 1000).toISOString(),
      };

      const updateRequest = new Request('http://localhost/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedExpense),
      });

      const response = await app.fetch(updateRequest, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        updated: true,
      });
    });

    it('updatedAtが古い場合は更新しない', async () => {
      const expense = createExpenseFixture({ amount: 3000 });

      // 最初に作成
      const createRequest = new Request('http://localhost/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(expense),
      });
      await app.fetch(createRequest, env);

      // 同じIDで古いupdatedAtを送信
      const oldExpense = {
        ...expense,
        amount: 5000,
        updatedAt: new Date(Date.now() - 1000).toISOString(),
      };

      const updateRequest = new Request('http://localhost/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(oldExpense),
      });

      const response = await app.fetch(updateRequest, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        updated: false,
        message: 'Already up to date',
      });
    });
  });

  describe('GET /expenses', () => {
    it('指定月の支出を取得できる', async () => {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const date = `${month}-15`;

      // テストデータを作成
      const expense1 = createExpenseFixture({
        amount: 3000,
        date,
      });
      const expense2 = createExpenseFixture({
        amount: 5000,
        date,
      });

      // 支出を登録
      for (const expense of [expense1, expense2]) {
        const request = new Request('http://localhost/expenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(expense),
        });
        await app.fetch(request, env);
      }

      // 支出を取得
      const request = new Request(`http://localhost/expenses?month=${month}`);
      const response = await app.fetch(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.month).toBe(month);
      expect(data.expenses).toHaveLength(2);
      expect(data.expenses[0].amount).toBe(3000);
      expect(data.expenses[1].amount).toBe(5000);
    });

    it('monthパラメータがない場合は現在の月を使用する', async () => {
      const request = new Request('http://localhost/expenses');
      const response = await app.fetch(request, env);
      const data = await response.json();

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      expect(response.status).toBe(200);
      expect(data.month).toBe(currentMonth);
      expect(data.expenses).toEqual([]);
    });

    it('指定月以外の支出は取得しない', async () => {
      const targetMonth = '2024-01';
      const otherMonth = '2024-02';

      const expense1 = createExpenseFixture({
        date: `${targetMonth}-15`,
        amount: 3000,
      });
      const expense2 = createExpenseFixture({
        date: `${otherMonth}-15`,
        amount: 5000,
      });

      // 支出を登録
      for (const expense of [expense1, expense2]) {
        const request = new Request('http://localhost/expenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(expense),
        });
        await app.fetch(request, env);
      }

      // 2024-01の支出のみ取得
      const request = new Request(`http://localhost/expenses?month=${targetMonth}`);
      const response = await app.fetch(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.month).toBe(targetMonth);
      expect(data.expenses).toHaveLength(1);
      expect(data.expenses[0].amount).toBe(3000);
    });
  });
});
