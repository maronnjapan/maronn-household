/**
 * ローカル（IndexedDB / Dexie）の支出の読み書き。fake-indexeddb の IndexedDB 実装の上で本物の Dexie を動かす
 */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createExpense } from '@maronn/domain';
import {
  addExpense,
  db,
  getExpensesByMonth,
  markSyncedIfUnchanged,
  mergeExpensesFromServer,
  updateExpense,
} from './db';

const USER_ID = 'user-1';

afterEach(async () => {
  await db.expenses.clear();
});

async function addWithItems() {
  const expense = createExpense({
    amount: 3280,
    date: '2026-11-19',
    deviceId: 'device-1',
    items: [
      { name: '牛乳', amount: 198, category: 'food' },
      { name: '洗剤', amount: 398, category: 'daily-goods' },
    ],
  });
  await addExpense(expense, USER_ID);
  return expense;
}

describe('addExpense / getExpensesByMonth', () => {
  it('内訳を支出と一緒に保存し、月の支出として読み出せる', async () => {
    const expense = await addWithItems();

    const [stored] = await getExpensesByMonth('2026-11', USER_ID);

    expect(stored).toMatchObject({ id: expense.id, amount: 3280, userId: USER_ID });
    expect(stored?.items).toEqual([
      { name: '牛乳', amount: 198, category: 'food' },
      { name: '洗剤', amount: 398, category: 'daily-goods' },
    ]);
  });
});

describe('updateExpense', () => {
  it('内訳を置き換え、同期待ちにする', async () => {
    const expense = await addWithItems();

    const updated = await updateExpense(expense.id, { items: [{ name: ' 卵 ', amount: 250 }] }, USER_ID);

    // 作成時に会計のカテゴリーは主なカテゴリー（日用品）になっているので、カテゴリーのない内訳はそれに計上する
    const expected = [{ name: '卵', amount: 250, category: 'daily-goods' }];
    expect(updated?.items).toEqual(expected);
    expect(updated?.syncStatus).toBe('pending');
    expect((await db.expenses.get(expense.id))?.items).toEqual(expected);
  });

  it('内訳を置き換えるとき、カテゴリーのない内訳には会計のカテゴリー（なければ主なカテゴリー）を入れる', async () => {
    const expense = await addWithItems();

    const updated = await updateExpense(
      expense.id,
      {
        category: undefined,
        items: [
          { name: '牛乳', amount: 198, category: 'food' },
          { name: '', amount: 3082 },
        ],
      },
      USER_ID
    );

    expect(updated?.category).toBe('other');
    expect(updated?.items).toEqual([
      { name: '牛乳', amount: 198, category: 'food' },
      { name: '', amount: 3082, category: 'other' },
    ]);
  });

  it('内訳に null や空の配列を渡すと内訳を消す（null: 内訳なしとして同期でサーバーの内訳も消す）', async () => {
    const expense = await addWithItems();
    const other = await addWithItems();

    await updateExpense(expense.id, { items: null }, USER_ID);
    await updateExpense(other.id, { items: [] }, USER_ID);

    expect((await db.expenses.get(expense.id))?.items).toBeNull();
    expect((await db.expenses.get(other.id))?.items).toBeNull();
  });

  it('items: undefined では内訳を消さない', async () => {
    const expense = await addWithItems();

    await updateExpense(expense.id, { amount: 3000, items: undefined }, USER_ID);

    const stored = await db.expenses.get(expense.id);
    expect(stored?.items).toHaveLength(2);
    expect(stored?.amount).toBe(3000);
  });

  it('店名は渡したときだけ変え（1行にそろえる）、null や空文字なら消す', async () => {
    const expense = createExpense({ amount: 3280, date: '2026-11-19', deviceId: 'device-1', storeName: 'スーパーA' });
    await addExpense(expense, USER_ID);

    expect((await updateExpense(expense.id, { memo: '変更' }))?.storeName).toBe('スーパーA');
    expect((await updateExpense(expense.id, { storeName: ' スーパーB\n 駅前 ' }))?.storeName).toBe('スーパーB 駅前');
    expect((await updateExpense(expense.id, { storeName: '' }))?.storeName).toBeNull();
  });

  it('内訳を渡さなければ内訳は変えない', async () => {
    const expense = await addWithItems();

    await updateExpense(expense.id, { amount: 3000 }, USER_ID);

    const stored = await db.expenses.get(expense.id);
    expect(stored?.amount).toBe(3000);
    expect(stored?.items).toHaveLength(2);
  });
});

describe('mergeExpensesFromServer', () => {
  it('サーバーの方が新しければ内訳もサーバーのものにする', async () => {
    const expense = await addWithItems();

    await mergeExpensesFromServer(
      [
        {
          ...expense,
          updatedAt: '2099-01-01T00:00:00.000Z',
          syncStatus: 'synced',
          items: [{ name: 'パン', amount: 300, category: 'food' }],
        },
      ],
      '2026-11',
      USER_ID
    );

    expect((await db.expenses.get(expense.id))?.items).toEqual([{ name: 'パン', amount: 300, category: 'food' }]);
  });

  it('同じ版でローカルに内訳の情報がなければ（内訳を知らない古いコードが取り込んだ行）、サーバーの内訳で補う', async () => {
    const expense = createExpense({ amount: 3280, date: '2026-11-19', deviceId: 'device-1' });
    await addExpense({ ...expense, syncStatus: 'synced' }, USER_ID);

    await mergeExpensesFromServer(
      [{ ...expense, syncStatus: 'synced', items: [{ name: '牛乳', amount: 198 }] }],
      '2026-11',
      USER_ID
    );

    expect((await db.expenses.get(expense.id))?.items).toEqual([{ name: '牛乳', amount: 198 }]);
  });

  it('同じ版で同期済みなのに内訳がサーバーと違えば（内訳のメモを知らない古いコードが取り込んだ行）、サーバーの内訳にする', async () => {
    const expense = await addWithItems();
    await db.expenses.update(expense.id, { syncStatus: 'synced' });
    const withMemo = [
      { name: '牛乳', amount: 198, category: 'food', memo: '特売' },
      { name: '洗剤', amount: 398, category: 'daily-goods' },
    ];

    await mergeExpensesFromServer([{ ...expense, syncStatus: 'synced', items: withMemo }], '2026-11', USER_ID);

    expect((await db.expenses.get(expense.id))?.items).toEqual(withMemo);
  });

  it('同じ版で店名を知らないコードが取り込んだ行・同期済みなのに店名が違う行は、サーバーの店名にする', async () => {
    const expense = createExpense({ amount: 3280, date: '2026-11-19', deviceId: 'device-1' });
    const { storeName: _storeName, ...unknownStore } = expense;
    await addExpense({ ...unknownStore, syncStatus: 'synced' }, USER_ID);

    await mergeExpensesFromServer([{ ...expense, syncStatus: 'synced', storeName: 'スーパーA' }], '2026-11', USER_ID);

    expect((await db.expenses.get(expense.id))?.storeName).toBe('スーパーA');

    await db.expenses.update(expense.id, { storeName: '古い店名' });
    await mergeExpensesFromServer([{ ...expense, syncStatus: 'synced', storeName: 'スーパーA' }], '2026-11', USER_ID);

    expect((await db.expenses.get(expense.id))?.storeName).toBe('スーパーA');
  });

  it('同じ版でも、ローカルが同期待ちなら内訳を書き換えない', async () => {
    const expense = await addWithItems();

    await mergeExpensesFromServer(
      [{ ...expense, syncStatus: 'synced', items: [{ name: 'パン', amount: 300, category: 'food' }] }],
      '2026-11',
      USER_ID
    );

    expect((await db.expenses.get(expense.id))?.items).toEqual(expense.items);
  });

  it('サーバーの新しい版に内訳の情報がなければ（内訳を知らない古いサーバー）、ローカルの内訳を残す', async () => {
    const expense = await addWithItems();
    const { items: _items, ...withoutItems } = expense;

    await mergeExpensesFromServer(
      [{ ...withoutItems, memo: '変更', updatedAt: '2099-01-01T00:00:00.000Z', syncStatus: 'synced' }],
      '2026-11',
      USER_ID
    );

    const stored = await db.expenses.get(expense.id);
    expect(stored?.memo).toBe('変更');
    expect(stored?.items).toHaveLength(2);
  });
});

describe('markSyncedIfUnchanged', () => {
  it('送った版のままなら同期済みにする', async () => {
    const expense = await addWithItems();

    await markSyncedIfUnchanged(expense.id, expense.updatedAt);

    expect((await db.expenses.get(expense.id))?.syncStatus).toBe('synced');
  });

  it('送っている間に編集されていれば（版が変わっていれば）同期待ちのままにする', async () => {
    const expense = await addWithItems();
    await db.expenses.update(expense.id, { updatedAt: '2099-01-01T00:00:00.000Z' });

    await markSyncedIfUnchanged(expense.id, expense.updatedAt);

    expect((await db.expenses.get(expense.id))?.syncStatus).toBe('pending');
  });
});
