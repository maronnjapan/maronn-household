import { describe, it, expect } from 'vitest';
import {
  CategoryError,
  EXPENSE_CATEGORIES,
  MAX_ACTIVE_CATEGORIES,
  MAX_CUSTOM_CATEGORIES,
  categoryLabel,
  findCategory,
  planCategoryCreation,
  planCategoryDeletion,
  planCategoryUpdate,
  resolveCategories,
  type CategoryRecord,
} from '../src/categories';

const NOW = '2026-11-21T10:00:00.000Z';

function record(overrides: Partial<CategoryRecord> & Pick<CategoryRecord, 'value' | 'label'>): CategoryRecord {
  return { deletedAt: null, createdAt: '2026-11-01T00:00:00.000Z', ...overrides };
}

function custom(value: string, label: string, createdAt: string, deletedAt: string | null = null): CategoryRecord {
  return { value, label, createdAt, deletedAt };
}

const values = (categories: { value: string }[]) => categories.map((category) => category.value);

describe('resolveCategories', () => {
  it('行がなければ既定のカテゴリーを定義順に返す（「その他」が最後）', () => {
    const categories = resolveCategories([]);

    expect(categories).toEqual(
      EXPENSE_CATEGORIES.map(({ value, label }) => ({ value, label, builtIn: true, deleted: false }))
    );
    expect(categories.at(-1)?.value).toBe('other');
  });

  it('既定のカテゴリーの名前変更と削除を反映する', () => {
    const categories = resolveCategories([
      record({ value: 'food', label: '食料品' }),
      record({ value: 'education', label: '教育費', deletedAt: NOW }),
    ]);

    expect(categories.find((c) => c.value === 'food')).toEqual({
      value: 'food',
      label: '食料品',
      builtIn: true,
      deleted: false,
    });
    expect(categories.find((c) => c.value === 'education')).toMatchObject({ builtIn: true, deleted: true });
  });

  it('追加したカテゴリーを作成順に、既定のカテゴリーのあと「その他」の前に並べ、削除済みも含める', () => {
    const categories = resolveCategories([
      custom('C2', '美容', '2026-11-03T00:00:00.000Z'),
      custom('C1', 'ペット', '2026-11-02T00:00:00.000Z'),
      custom('C3', '旅行', '2026-11-04T00:00:00.000Z', NOW),
    ]);

    expect(values(categories).slice(-5)).toEqual(['insurance', 'C1', 'C2', 'C3', 'other']);
    expect(categories.find((c) => c.value === 'C1')).toEqual({
      value: 'C1',
      label: 'ペット',
      builtIn: false,
      deleted: false,
    });
    expect(categories.find((c) => c.value === 'C3')?.deleted).toBe(true);
  });
});

describe('categoryLabel', () => {
  const categories = resolveCategories([
    record({ value: 'food', label: '食料品' }),
    custom('C1', 'ペット', '2026-11-02T00:00:00.000Z', NOW),
  ]);

  it('名前を変えたカテゴリーは新しい名前、削除済みのカテゴリーも名前を返す', () => {
    expect(categoryLabel(categories, 'food')).toBe('食料品');
    expect(categoryLabel(categories, 'daily-goods')).toBe('日用品');
    expect(categoryLabel(categories, 'C1')).toBe('ペット');
  });

  it('知らない値は undefined', () => {
    expect(categoryLabel(categories, '食費')).toBeUndefined();
  });
});

describe('findCategory', () => {
  const categories = resolveCategories([
    custom('01JDPET', 'Pet', '2026-11-02T00:00:00.000Z'),
    custom('01JDOLD', '旅行', '2026-11-03T00:00:00.000Z', NOW),
  ]);

  it('有効なカテゴリーを value でも名前でも見つける（前後の空白・全角半角・大文字小文字は区別しない）', () => {
    expect(findCategory(categories, 'food').value).toBe('food');
    expect(findCategory(categories, '日用品').value).toBe('daily-goods');
    expect(findCategory(categories, ' ｐｅｔ ').value).toBe('01JDPET');
    expect(findCategory(categories, '01jdpet').value).toBe('01JDPET');
  });

  it('知らないカテゴリーは、使えるカテゴリーの名前を添えてエラーにする', () => {
    expect(() => findCategory(categories, 'ペット用品')).toThrow(CategoryError);
    expect(() => findCategory(categories, 'ペット用品')).toThrow(/ペット用品.*食費.*Pet.*その他/);
  });

  it('削除済みのカテゴリーは使えない（削除済みであることを伝える）', () => {
    expect(() => findCategory(categories, '旅行')).toThrow(/削除済み/);
    expect(() => findCategory(categories, '01JDOLD')).toThrow(/削除済み/);
  });
});

describe('planCategoryCreation', () => {
  const context = { now: NOW, newId: () => '01JDNEW' };

  it('新しいカテゴリーを newId の value で作る（名前の前後の空白は除く）', () => {
    const plan = planCategoryCreation(resolveCategories([]), '  ペット  ', context);

    expect(plan).toEqual({
      status: 'created',
      category: { value: '01JDNEW', label: 'ペット', builtIn: false, deleted: false },
      change: { value: '01JDNEW', label: 'ペット', deletedAt: null, updatedAt: NOW },
    });
  });

  it('有効なカテゴリーと同じ名前（または value）なら作らずにそれを返す', () => {
    const categories = resolveCategories([custom('01JDPET', 'Pet', '2026-11-02T00:00:00.000Z')]);

    expect(planCategoryCreation(categories, '食費', context)).toEqual({
      status: 'existing',
      category: { value: 'food', label: '食費', builtIn: true, deleted: false },
      change: null,
    });
    expect(planCategoryCreation(categories, 'ＰＥＴ', context).category.value).toBe('01JDPET');
    expect(planCategoryCreation(categories, 'other', context)).toMatchObject({ status: 'existing' });
  });

  it('削除済みのカテゴリーと同じ名前なら、それを復元する', () => {
    const categories = resolveCategories([
      record({ value: 'education', label: '教育費', deletedAt: NOW }),
      custom('01JDOLD', '旅行', '2026-11-03T00:00:00.000Z', NOW),
    ]);

    expect(planCategoryCreation(categories, '教育費', context)).toEqual({
      status: 'restored',
      category: { value: 'education', label: '教育費', builtIn: true, deleted: false },
      change: { value: 'education', label: '教育費', deletedAt: null, updatedAt: NOW },
    });
    expect(planCategoryCreation(categories, '旅行', context).change?.value).toBe('01JDOLD');
  });

  it('同じ名前の削除済みが複数あれば、一覧の並びで最初のもの（既定 → 古い追加分）を復元する', () => {
    const categories = resolveCategories([
      custom('01JDNEWER', '旅行', '2026-11-05T00:00:00.000Z', NOW),
      custom('01JDOLDER', '旅行', '2026-11-03T00:00:00.000Z', NOW),
    ]);

    expect(planCategoryCreation(categories, '旅行', context).change?.value).toBe('01JDOLDER');
  });

  it.each([
    ['空の名前', '   '],
    ['長すぎる名前', 'あ'.repeat(31)],
    ['改行を含む名前', 'ペット\n費'],
  ])('%sはエラー', (_label, label) => {
    expect(() => planCategoryCreation(resolveCategories([]), label, context)).toThrow(CategoryError);
  });

  it(`有効なカテゴリーが ${MAX_ACTIVE_CATEGORIES} 件あれば、作成も復元もできない`, () => {
    const records = Array.from({ length: MAX_ACTIVE_CATEGORIES - EXPENSE_CATEGORIES.length }, (_, i) =>
      custom(`C${String(i).padStart(2, '0')}`, `追加${i}`, '2026-11-02T00:00:00.000Z')
    );
    const full = resolveCategories([...records, custom('01JDOLD', '旅行', '2026-11-03T00:00:00.000Z', NOW)]);

    expect(() => planCategoryCreation(full, 'ペット', context)).toThrow(/30/);
    expect(() => planCategoryCreation(full, '旅行', context)).toThrow(/30/);
    expect(planCategoryCreation(full, '食費', context).status).toBe('existing');
  });

  it(`追加したカテゴリーが削除済みを含めて ${MAX_CUSTOM_CATEGORIES} 件あれば、新しくは作れない（復元はできる）`, () => {
    const deleted = Array.from({ length: MAX_CUSTOM_CATEGORIES }, (_, i) =>
      custom(`C${String(i).padStart(3, '0')}`, `削除${i}`, '2026-11-02T00:00:00.000Z', NOW)
    );
    const categories = resolveCategories(deleted);

    expect(() => planCategoryCreation(categories, 'ペット', context)).toThrow(/100/);
    expect(planCategoryCreation(categories, '削除0', context).status).toBe('restored');
  });
});

describe('planCategoryUpdate', () => {
  const categories = resolveCategories([
    custom('01JDPET', 'ペット', '2026-11-02T00:00:00.000Z'),
    custom('01JDOLD', '旅行', '2026-11-03T00:00:00.000Z', NOW),
  ]);

  it('カテゴリーの名前を変える（既定のカテゴリーも、名前で指定しても変えられる）', () => {
    expect(planCategoryUpdate(categories, 'food', '食料品', NOW)).toEqual({
      category: { value: 'food', label: '食料品', builtIn: true, deleted: false },
      change: { value: 'food', label: '食料品', deletedAt: null, updatedAt: NOW },
    });
    expect(planCategoryUpdate(categories, 'ペット', ' ペット・動物 ', NOW).change).toEqual({
      value: '01JDPET',
      label: 'ペット・動物',
      deletedAt: null,
      updatedAt: NOW,
    });
  });

  it('同じ名前のままや、大文字小文字だけの変更もできる（自分自身とは重複とみなさない）', () => {
    const withPet = resolveCategories([custom('01JDPET', 'Pet', '2026-11-02T00:00:00.000Z')]);

    expect(planCategoryUpdate(categories, '食費', '食費', NOW).change.label).toBe('食費');
    expect(planCategoryUpdate(withPet, 'pet', 'PET', NOW).change).toMatchObject({ value: '01JDPET', label: 'PET' });
  });

  it('他の有効なカテゴリーの名前や value と同じ名前にはできない', () => {
    expect(() => planCategoryUpdate(categories, 'ペット', '食費', NOW)).toThrow(/食費/);
    expect(() => planCategoryUpdate(categories, 'ペット', 'food', NOW)).toThrow(CategoryError);
  });

  it('削除済みのカテゴリーと同じ名前にはできる', () => {
    expect(planCategoryUpdate(categories, 'ペット', '旅行', NOW).change.label).toBe('旅行');
  });

  it('削除済み・知らないカテゴリーは変えられない', () => {
    expect(() => planCategoryUpdate(categories, '旅行', '旅', NOW)).toThrow(/削除済み/);
    expect(() => planCategoryUpdate(categories, 'ない', '旅', NOW)).toThrow(CategoryError);
  });
});

describe('planCategoryDeletion', () => {
  const categories = resolveCategories([
    record({ value: 'other', label: '雑費' }),
    custom('01JDPET', 'ペット', '2026-11-02T00:00:00.000Z'),
  ]);

  it('名前を保ったまま削除日時を付ける（既定のカテゴリーも、名前で指定しても削除できる）', () => {
    expect(planCategoryDeletion(categories, 'ペット', NOW)).toEqual({
      category: { value: '01JDPET', label: 'ペット', builtIn: false, deleted: true },
      change: { value: '01JDPET', label: 'ペット', deletedAt: NOW, updatedAt: NOW },
    });
    expect(planCategoryDeletion(categories, 'education', NOW).change).toEqual({
      value: 'education',
      label: '教育費',
      deletedAt: NOW,
      updatedAt: NOW,
    });
  });

  it('カテゴリーのない支出の計上先（other）は、名前を変えていても削除できない', () => {
    expect(() => planCategoryDeletion(categories, '雑費', NOW)).toThrow(/雑費.*削除できません/);
    expect(() => planCategoryDeletion(categories, 'other', NOW)).toThrow(CategoryError);
  });

  it('知らないカテゴリーは削除できない', () => {
    expect(() => planCategoryDeletion(categories, 'ない', NOW)).toThrow(CategoryError);
  });
});
