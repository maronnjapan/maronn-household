import { describe, it, expect } from 'vitest';
import { resolveCategories } from '@maronn/domain';
import { DEFAULT_CATEGORIES, categoryChoices, parseCategoryCache, serializeCategoryCache } from './categories';

const categories = resolveCategories([
  { value: 'food', label: '食料品', deletedAt: null, createdAt: '2026-11-01T00:00:00.000Z' },
  { value: '01JDPET', label: 'ペット', deletedAt: null, createdAt: '2026-11-02T00:00:00.000Z' },
  { value: '01JDOLD', label: '旅行', deletedAt: '2026-11-03T00:00:00.000Z', createdAt: '2026-11-02T00:00:00.000Z' },
]);

describe('categoryChoices', () => {
  it('有効なカテゴリー（名前変更・追加を反映、削除済みを除く）を選択肢にする', () => {
    const choices = categoryChoices(categories, '');

    expect(choices[0]).toEqual({ value: 'food', label: '食料品' });
    expect(choices.map((choice) => choice.value)).toContain('01JDPET');
    expect(choices.map((choice) => choice.value)).not.toContain('01JDOLD');
    expect(choices.at(-1)).toEqual({ value: 'other', label: 'その他' });
  });

  it('選んでいる値が削除済みのカテゴリーなら「名前（削除済み）」として選択肢に加える', () => {
    expect(categoryChoices(categories, '01JDOLD').at(-1)).toEqual({ value: '01JDOLD', label: '旅行（削除済み）' });
  });

  it('選んでいる値が知らない値（CSV から取り込んだ値や、一覧の取得前の追加カテゴリー）なら値そのものを加える', () => {
    expect(categoryChoices(DEFAULT_CATEGORIES, '01JDPET').at(-1)).toEqual({ value: '01JDPET', label: '01JDPET' });
  });

  it('選んでいる値が選択肢にあれば何も加えない', () => {
    expect(categoryChoices(categories, '01JDPET')).toHaveLength(categoryChoices(categories, '').length);
  });
});

describe('parseCategoryCache', () => {
  it('保存した一覧を、同じユーザーにだけ返す', () => {
    const raw = serializeCategoryCache('user-1', categories);

    expect(parseCategoryCache(raw, 'user-1')).toEqual(categories);
    expect(parseCategoryCache(raw, 'user-2')).toBeUndefined();
  });

  it.each([
    ['保存していない', null],
    ['壊れた JSON', '{'],
    ['形の違うデータ', JSON.stringify({ userId: 'user-1', categories: [{ value: 'food' }] })],
  ])('%s場合は undefined', (_label, raw) => {
    expect(parseCategoryCache(raw, 'user-1')).toBeUndefined();
  });
});
