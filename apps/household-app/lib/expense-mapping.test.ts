import { describe, expect, it } from 'vitest';
import type { ExpenseEntity } from '@maronn/domain';
import { toLocalExpense, toUploadPayload } from './expense-mapping';

const SERVER_ROW = {
  id: '01JEXPENSE',
  amount: 3280,
  category: null,
  memo: 'スーパーA',
  date: '2026-11-19',
  createdAt: '2026-11-19T10:00:00.000Z',
  updatedAt: '2026-11-19T10:00:00.000Z',
  deviceId: 'device-1',
  subBudgetId: null,
};

describe('toLocalExpense', () => {
  it('サーバーの行を同期済みのローカルの支出にし、内訳も写す（null の項目は持たない）', () => {
    const local = toLocalExpense({
      ...SERVER_ROW,
      items: [
        { name: '牛乳', amount: 198, quantity: null, category: 'food' },
        { name: '洗剤', amount: 398, quantity: 2, category: null },
      ],
    });

    expect(local).toEqual({
      id: '01JEXPENSE',
      amount: 3280,
      category: undefined,
      memo: 'スーパーA',
      date: '2026-11-19',
      createdAt: '2026-11-19T10:00:00.000Z',
      updatedAt: '2026-11-19T10:00:00.000Z',
      deviceId: 'device-1',
      syncStatus: 'synced',
      subBudgetId: undefined,
      items: [
        { name: '牛乳', amount: 198, category: 'food' },
        { name: '洗剤', amount: 398, quantity: 2 },
      ],
    });
  });

  it('サーバーに内訳がなければ items は null（内訳なしと分かっている）', () => {
    expect(toLocalExpense({ ...SERVER_ROW, items: null }).items).toBeNull();
    expect(toLocalExpense({ ...SERVER_ROW, items: [] }).items).toBeNull();
  });

  it('サーバーが items を返さなければ（内訳を知らない古いサーバー）items は undefined（不明）', () => {
    expect(toLocalExpense(SERVER_ROW).items).toBeUndefined();
  });
});

describe('toUploadPayload', () => {
  const local: ExpenseEntity = {
    id: '01JEXPENSE',
    amount: 3280,
    category: 'food',
    memo: undefined,
    date: '2026-11-19',
    createdAt: '2026-11-19T10:00:00.000Z',
    updatedAt: '2026-11-19T10:00:00.000Z',
    deviceId: 'device-1',
    syncStatus: 'pending',
    subBudgetId: undefined,
  };

  it('内訳を含めた全状態を送る', () => {
    const payload = toUploadPayload({ ...local, items: [{ name: '牛乳', amount: 198 }] });

    expect(payload).toEqual({
      id: '01JEXPENSE',
      amount: 3280,
      category: 'food',
      memo: undefined,
      date: '2026-11-19',
      createdAt: '2026-11-19T10:00:00.000Z',
      updatedAt: '2026-11-19T10:00:00.000Z',
      deviceId: 'device-1',
      subBudgetId: undefined,
      items: [{ name: '牛乳', amount: 198 }],
    });
  });

  it('内訳なし（null・空）なら null を送る（サーバーの内訳も消す）', () => {
    expect(toUploadPayload({ ...local, items: null }).items).toBeNull();
    expect(toUploadPayload({ ...local, items: [] }).items).toBeNull();
  });

  it('内訳が不明（undefined。内訳を知らないコードが書いた行）なら items を送らない（サーバーの内訳を変えない）', () => {
    const payload = toUploadPayload(local);

    expect(payload.items).toBeUndefined();
    expect(JSON.parse(JSON.stringify(payload))).not.toHaveProperty('items');
  });
});
