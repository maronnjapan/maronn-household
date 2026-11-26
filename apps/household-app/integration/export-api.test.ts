/**
 * エクスポート API（GET /api/v1/export/monthly）の通しのテスト。本物のローカル D1 を使う
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@maronn/test-utils';
import { hashToken } from '../lib/api-token';
import { exportApiHandler } from '../server/export-api-handler';

const USER_ID = 'user-1';
const TOKEN = 'test-token';

let testDb: TestDatabase;

beforeEach(async () => {
  testDb = await createTestDatabase();
  await testDb.db
    .prepare("INSERT INTO api_tokens (token_hash, user_id, created_at, is_active) VALUES (?, ?, 'x', 1)")
    .bind(await hashToken(TOKEN), USER_ID)
    .run();
});

afterEach(async () => {
  await testDb.dispose();
});

async function getMonthly(month: string) {
  const handler = exportApiHandler('/api/v1/export');
  const response = await handler(
    new Request(`https://maronn-household-budget.com/api/v1/export/monthly?month=${month}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    }),
    {},
    { runtime: 'workerd', adapter: 'other', params: undefined, env: { DB: testDb.db } }
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('GET /monthly', () => {
  it('支出（1回の会計）ごとに支払総額・内訳・店名・レシートIDを返す', async () => {
    const items = [
      { name: '牛乳', amount: 198, category: 'food' },
      { name: '洗剤', amount: 398, category: 'daily-goods' },
    ];
    await testDb.db
      .prepare(
        "INSERT INTO expenses (id, user_id, amount, category, memo, store_name, date, created_at, updated_at, device_id, receipt_id, items) VALUES ('e1', ?, 650, 'daily-goods', '特売', 'スーパーA', '2026-11-19', 'x', 'x', 'd', 'r1', ?), ('e2', ?, 500, 'food', NULL, NULL, '2026-11-20', 'x', 'x', 'd', NULL, NULL)"
      )
      .bind(USER_ID, JSON.stringify(items), USER_ID)
      .run();

    const { status, body } = await getMonthly('2026-11');

    expect(status).toBe(200);
    expect(body.expenses).toEqual([
      { id: 'e1', amount: 650, category: 'daily-goods', memo: '特売', storeName: 'スーパーA', date: '2026-11-19', createdAt: 'x', receiptId: 'r1', items },
      { id: 'e2', amount: 500, category: 'food', memo: null, storeName: null, date: '2026-11-20', createdAt: 'x', receiptId: null, items: null },
    ]);
    expect(body.summary).toMatchObject({ totalExpenses: 1150, expenseCount: 2 });
  });
});
