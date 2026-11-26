import { describe, it, expect } from 'vitest';
import type { ExpenseEntity } from '../src/expense';
import { mergeExpenses } from '../src/sync';

const base: ExpenseEntity = {
  id: '01JEXPENSE',
  amount: 3280,
  category: 'food',
  memo: 'スーパーA',
  date: '2026-11-19',
  createdAt: '2026-11-19T10:00:00.000Z',
  updatedAt: '2026-11-19T10:00:00.000Z',
  syncStatus: 'synced',
  deviceId: 'device-a',
};
const ITEMS = [
  { name: '牛乳', amount: 198, category: 'food' },
  { name: '洗剤', amount: 398, category: 'daily-goods' },
];
const LATER = '2026-11-19T11:00:00.000Z';

describe('mergeExpenses', () => {
  it('サーバーにしかない支出は同期済みとして追加する', () => {
    const result = mergeExpenses([], [{ ...base, items: ITEMS }]);

    expect(result.toAdd).toEqual([{ ...base, items: ITEMS, syncStatus: 'synced' }]);
  });

  it('ローカルに未送信の編集がなければ、別の端末の新しい版をそのまま採用する（複製を作らない）', () => {
    const remote = { ...base, updatedAt: LATER, deviceId: 'device-b', items: ITEMS };

    const result = mergeExpenses([base], [remote]);

    expect(result.toUpdate).toEqual([{ ...remote, syncStatus: 'synced' }]);
    expect(result.conflicts).toEqual([]);
  });

  it('ローカルに未送信の編集があり、別の端末でも編集されていれば両方残す（リモートに新しい ID）', () => {
    const local = { ...base, syncStatus: 'pending' as const, updatedAt: '2026-11-19T10:30:00.000Z' };
    const remote = { ...base, updatedAt: LATER, deviceId: 'device-b', items: ITEMS };

    const result = mergeExpenses([local], [remote]);

    expect(result.toUpdate).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.remote).toMatchObject({ amount: 3280, items: ITEMS, syncStatus: 'synced' });
    expect(result.conflicts[0]?.remote.id).not.toBe(base.id);
  });

  it('同じ版でも、ローカルに内訳の情報がなく（内訳を知らない古いコードが取り込んだ行）サーバーにあれば内訳を補う', () => {
    const result = mergeExpenses([base], [{ ...base, items: ITEMS }]);

    expect(result.toUpdate).toEqual([{ ...base, items: ITEMS, syncStatus: 'synced' }]);
  });

  it('同じ版で同期済みなのに内訳がサーバーと違えば（内訳のメモを知らない古いコードが取り込んだ行）、サーバーの内訳にする', () => {
    const withMemo = [{ name: '牛乳', amount: 198, category: 'food', memo: '特売' }];
    const result = mergeExpenses(
      [{ ...base, items: [{ name: '牛乳', amount: 198, category: 'food' }] }],
      [{ ...base, items: withMemo }]
    );

    expect(result.toUpdate).toEqual([{ ...base, items: withMemo, syncStatus: 'synced' }]);
  });

  it('同じ版でも、ローカルが同期待ちなら内訳を書き換えない', () => {
    const local = { ...base, syncStatus: 'pending' as const, items: [{ name: '牛乳', amount: 198 }] };

    const result = mergeExpenses([local], [{ ...base, items: ITEMS }]);

    expect(result).toEqual({ toAdd: [], toUpdate: [], conflicts: [] });
  });

  it('同じ版で、ローカルとサーバーが内訳を同じく知っていれば何もしない', () => {
    const result = mergeExpenses(
      [{ ...base, items: null }, { ...base, id: 'with-items', items: ITEMS }],
      [{ ...base, items: [] }, { ...base, id: 'with-items', items: ITEMS.map((item) => ({ ...item })) }]
    );

    expect(result).toEqual({ toAdd: [], toUpdate: [], conflicts: [] });
  });

  it('サーバーの新しい版に内訳の情報がなければ（内訳を知らない古いサーバー）、ローカルの内訳を残す', () => {
    const remote = { ...base, updatedAt: LATER, memo: '変更' };

    const result = mergeExpenses([{ ...base, items: ITEMS }], [remote]);

    expect(result.toUpdate).toEqual([{ ...remote, items: ITEMS, syncStatus: 'synced' }]);
  });

  it('ローカルの方が新しければ何もしない（次のアップロードで送る）', () => {
    const local = { ...base, syncStatus: 'pending' as const, updatedAt: LATER };

    expect(mergeExpenses([local], [base])).toEqual({ toAdd: [], toUpdate: [], conflicts: [] });
  });
});
