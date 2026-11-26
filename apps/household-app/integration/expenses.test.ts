/**
 * 支出（tRPC）の通しのテスト。1回の会計 = 支出1件（amount は支払総額）と、その内訳（items）
 *
 * データベースは本物のローカル D1（全マイグレーションを適用）を使う。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@maronn/test-utils';
import { dbD1 } from '@maronn/db-schema/db';
import { appRouter } from '../trpc/server';

const USER = { id: 'user-1', name: '山田太郎', email: 'taro@example.com', image: null };
const OTHER = { id: 'user-2', name: '佐藤花子', email: 'hanako@example.com', image: null };

let testDb: TestDatabase;

beforeEach(async () => {
  testDb = await createTestDatabase();
});

afterEach(async () => {
  await testDb.dispose();
});

function callerFor(user: typeof USER | null) {
  return appRouter.createCaller({ db: dbD1(testDb.db), user, session: null, resHeaders: new Headers() });
}

const ITEMS = [
  { name: '牛乳', amount: 198, category: 'food' },
  { name: '洗剤', amount: 398, quantity: 2, category: 'daily-goods' },
];

const EXPENSE = {
  id: '01JEXPENSE00000000000000001',
  amount: 3280,
  category: 'food',
  memo: 'スーパーA',
  date: '2026-11-19',
  createdAt: '2026-11-19T10:00:00.000Z',
  updatedAt: '2026-11-19T10:00:00.000Z',
  deviceId: 'device-1',
};

async function storedRow(id = EXPENSE.id) {
  return testDb.db
    .prepare('SELECT user_id, amount, category, memo, items, updated_at FROM expenses WHERE id = ?')
    .bind(id)
    .first<{ user_id: string; amount: number; category: string | null; memo: string | null; items: string | null; updated_at: string }>();
}

describe('createExpense（同期のアップサート）と getExpenses', () => {
  it('支払総額の支出1件と内訳を保存し、月の支出として内訳付きで返す', async () => {
    await callerFor(USER).createExpense({ ...EXPENSE, items: ITEMS });

    const { expenses } = await callerFor(USER).getExpenses({ month: '2026-11' });

    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ id: EXPENSE.id, amount: 3280, category: 'food', items: ITEMS });
    expect(JSON.parse((await storedRow())!.items!)).toEqual(ITEMS);
  });

  it('内訳のない支出の items は null で返す（キーは必ずある）', async () => {
    await callerFor(USER).createExpense(EXPENSE);
    await callerFor(USER).createExpense({ ...EXPENSE, id: '01JEXPENSE00000000000000002', items: null });
    await callerFor(USER).createExpense({ ...EXPENSE, id: '01JEXPENSE00000000000000003', items: [] });

    const { expenses } = await callerFor(USER).getExpenses({ month: '2026-11' });

    expect(expenses.map((e) => e.items)).toEqual([null, null, null]);
  });

  it('新しい版で items を送らなければ（内訳を知らない古いクライアント）、内訳を変えずに他の項目を更新する', async () => {
    await callerFor(USER).createExpense({ ...EXPENSE, items: ITEMS });

    await callerFor(USER).createExpense({ ...EXPENSE, memo: '変更', updatedAt: '2026-11-19T11:00:00.000Z' });

    const row = await storedRow();
    expect(row?.memo).toBe('変更');
    expect(JSON.parse(row!.items!)).toEqual(ITEMS);
  });

  it('新しい版で items: null を送ると内訳を消し、配列なら置き換える', async () => {
    const second = { ...EXPENSE, id: '01JEXPENSE00000000000000002' };
    await callerFor(USER).createExpense({ ...EXPENSE, items: ITEMS });
    await callerFor(USER).createExpense({ ...second, items: ITEMS });

    await callerFor(USER).createExpense({ ...EXPENSE, items: null, updatedAt: '2026-11-19T11:00:00.000Z' });
    await callerFor(USER).createExpense({
      ...second,
      items: [{ name: 'パン', amount: 300 }],
      updatedAt: '2026-11-19T11:00:00.000Z',
    });

    expect((await storedRow())?.items).toBeNull();
    expect(JSON.parse((await storedRow(second.id))!.items!)).toEqual([{ name: 'パン', amount: 300 }]);
  });

  it('古い版では内訳も含めて何も変えない', async () => {
    await callerFor(USER).createExpense({ ...EXPENSE, items: ITEMS, updatedAt: '2026-11-19T11:00:00.000Z' });

    const result = await callerFor(USER).createExpense({ ...EXPENSE, items: null });

    expect(result).toMatchObject({ success: true, updated: false });
    expect(JSON.parse((await storedRow())!.items!)).toEqual(ITEMS);
  });

  it('他のユーザーの支出と同じ ID では、その支出を書き換えない', async () => {
    await callerFor(OTHER).createExpense({ ...EXPENSE, items: ITEMS });

    await expect(
      callerFor(USER).createExpense({ ...EXPENSE, amount: 1, items: null, updatedAt: '2026-11-19T11:00:00.000Z' })
    ).rejects.toThrow();

    const row = await storedRow();
    expect(row).toMatchObject({ user_id: OTHER.id, amount: 3280 });
    expect(JSON.parse(row!.items!)).toEqual(ITEMS);
    expect((await callerFor(USER).getExpenses({ month: '2026-11' })).expenses).toEqual([]);
  });

  it('内訳のメモ（MCP で記録した明細のメモ）も保存して返す（アプリで編集して送り直してもメモが消えない）', async () => {
    const items = [{ name: 'ケーキ', amount: 1200, category: 'food', memo: '誕生日用' }];

    await callerFor(USER).createExpense({ ...EXPENSE, items });

    const { expenses } = await callerFor(USER).getExpenses({ month: '2026-11' });
    expect(expenses[0]?.items).toEqual(items);
    expect(JSON.parse((await storedRow())!.items!)).toEqual(items);
  });

  it.each([
    ['負の金額の内訳', [{ name: '値引き', amount: -100 }]],
    ['小数の金額の内訳', [{ name: '牛乳', amount: 1.5 }]],
    ['長すぎる品名', [{ name: 'あ'.repeat(101), amount: 100 }]],
    ['上限を超える金額の内訳', [{ name: '家', amount: 100_000_001 }]],
    ['上限を超える数量の内訳', [{ name: 'ねじ', amount: 100, quantity: 10_001 }]],
    ['長すぎるカテゴリー', [{ name: '牛乳', amount: 100, category: 'x'.repeat(41) }]],
    ['長すぎる内訳のメモ', [{ name: '牛乳', amount: 100, memo: 'あ'.repeat(201) }]],
    ['多すぎる内訳', Array.from({ length: 201 }, (_, i) => ({ name: `品${i}`, amount: 1 }))],
  ])('%sは受け付けない', async (_label, items) => {
    await expect(callerFor(USER).createExpense({ ...EXPENSE, items })).rejects.toThrow();
    expect(await storedRow()).toBeNull();
  });

  it('ログインしていなければ使えない', async () => {
    await expect(callerFor(null).createExpense(EXPENSE)).rejects.toThrow(/logged in/);
  });
});

describe('updateExpense', () => {
  it('新しい版の内訳で置き換え、items を送らなければ内訳を変えない', async () => {
    await callerFor(USER).createExpense({ ...EXPENSE, items: ITEMS });

    await callerFor(USER).updateExpense({
      id: EXPENSE.id,
      items: [{ name: 'パン', amount: 300 }],
      updatedAt: '2026-11-19T11:00:00.000Z',
      deviceId: 'device-2',
    });
    await callerFor(USER).updateExpense({
      id: EXPENSE.id,
      memo: 'メモだけ変更',
      updatedAt: '2026-11-19T12:00:00.000Z',
      deviceId: 'device-2',
    });

    const row = await storedRow();
    expect(row?.memo).toBe('メモだけ変更');
    expect(JSON.parse(row!.items!)).toEqual([{ name: 'パン', amount: 300 }]);
  });

  it('items: null で内訳を消す', async () => {
    await callerFor(USER).createExpense({ ...EXPENSE, items: ITEMS });

    await callerFor(USER).updateExpense({
      id: EXPENSE.id,
      items: null,
      updatedAt: '2026-11-19T11:00:00.000Z',
      deviceId: 'device-2',
    });

    expect((await storedRow())?.items).toBeNull();
  });

  it('他のユーザーの支出は更新できない', async () => {
    await callerFor(OTHER).createExpense({ ...EXPENSE, items: ITEMS });

    await expect(
      callerFor(USER).updateExpense({ id: EXPENSE.id, items: null, updatedAt: '2026-11-19T11:00:00.000Z', deviceId: 'd' })
    ).rejects.toThrow(/not found/);
    expect(JSON.parse((await storedRow())!.items!)).toEqual(ITEMS);
  });
});

describe('マイグレーション', () => {
  it('壊れた JSON や配列でない値は items に保存できない（1行壊れると月の取得がすべて失敗するため）', async () => {
    await callerFor(USER).createExpense(EXPENSE);

    for (const value of ['{x', '{}', '"text"']) {
      await expect(
        testDb.db.prepare('UPDATE expenses SET items = ? WHERE id = ?').bind(value, EXPENSE.id).run()
      ).rejects.toThrow(/CHECK/);
    }
  });
});
