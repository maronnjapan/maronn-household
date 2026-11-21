/**
 * 支出カテゴリー
 *
 * 既定のカテゴリー（EXPENSE_CATEGORIES）に、ユーザーごとの変更（categories テーブルの行）を重ねて、
 * そのユーザーのカテゴリーの一覧を作る。行を持つのは、追加したカテゴリーと、既定のカテゴリーの名前変更・削除だけ。
 *
 * 支出（expenses.category）にはカテゴリーの value を保存し、名前変更や削除で支出の行は書き換えない
 * （サーバーで支出を書き換えると、端末の未送信の編集との同期で消えたり巻き戻ったりするため）。
 * そのため value は変えず、削除しても行を残して、過去の支出の表示名に使う。
 */
export const EXPENSE_CATEGORIES = [
  { value: 'food', label: '食費' },
  { value: 'daily-goods', label: '日用品' },
  { value: 'transportation', label: '交通費' },
  { value: 'utilities', label: '光熱費' },
  { value: 'communication', label: '通信費' },
  { value: 'medical', label: '医療費' },
  { value: 'entertainment', label: '娯楽費' },
  { value: 'clothing', label: '被服費' },
  { value: 'education', label: '教育費' },
  { value: 'housing', label: '住居費' },
  { value: 'insurance', label: '保険料' },
  { value: 'other', label: 'その他' },
] as const;

export type ExpenseCategoryValue = (typeof EXPENSE_CATEGORIES)[number]['value'];

export const EXPENSE_CATEGORY_VALUES = EXPENSE_CATEGORIES.map((category) => category.value) as [
  ExpenseCategoryValue,
  ...ExpenseCategoryValue[],
];

/** カテゴリーのない支出の計上先。削除できない（名前は変えられる） */
export const FALLBACK_CATEGORY: ExpenseCategoryValue = 'other';

export const MAX_CATEGORY_LABEL_LENGTH = 30;
/** 有効なカテゴリー（既定のカテゴリーを含む）の上限 */
export const MAX_ACTIVE_CATEGORIES = 30;
/** 追加したカテゴリー（削除済みを含む）の上限 */
export const MAX_CUSTOM_CATEGORIES = 100;

/** categories テーブルの行 */
export interface CategoryRecord {
  value: string;
  label: string;
  /** 削除日時（ISO 8601）。削除していなければ null */
  deletedAt: string | null;
  createdAt: string;
}

/** ユーザーのカテゴリー */
export interface Category {
  /** 支出・レシート明細の category に保存する値（既定は 'food' など、追加したカテゴリーは ULID） */
  value: string;
  label: string;
  /** 既定のカテゴリー（追加したものでない） */
  builtIn: boolean;
  /** 削除済み（新しい記録には使わない。過去の支出の表示名にだけ使う） */
  deleted: boolean;
}

/** categories テーブルに保存する変更（同じ value の行があれば上書きする） */
export interface CategoryChange {
  value: string;
  label: string;
  deletedAt: string | null;
  updatedAt: string;
}

/** カテゴリーの操作の誤り（重複・上限・削除できないカテゴリーなど）。メッセージはそのまま利用者に見せる */
export class CategoryError extends Error {
  override name = 'CategoryError';
}

const BUILT_IN_VALUES = new Set<string>(EXPENSE_CATEGORY_VALUES);

/**
 * ユーザーのカテゴリーの一覧
 * 既定のカテゴリー（定義順。名前変更・削除を反映）→ 追加したカテゴリー（作成順）→ 「その他」の順。削除済みも含む。
 * 既定のカテゴリーを将来増やして追加分と名前が重なった場合は両方並び、名前での指定は既定が優先される
 */
export function resolveCategories(records: CategoryRecord[]): Category[] {
  const overrides = new Map(records.map((record) => [record.value, record]));
  const builtIns = EXPENSE_CATEGORIES.map(({ value, label }): Category => {
    const override = overrides.get(value);
    return { value, label: override?.label ?? label, builtIn: true, deleted: Boolean(override?.deletedAt) };
  });
  const added = records
    .filter((record) => !BUILT_IN_VALUES.has(record.value))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.value.localeCompare(b.value))
    .map(({ value, label, deletedAt }): Category => ({ value, label, builtIn: false, deleted: Boolean(deletedAt) }));
  const isFallback = (category: Category) => category.value === FALLBACK_CATEGORY;
  return [...builtIns.filter((c) => !isFallback(c)), ...added, ...builtIns.filter(isFallback)];
}

/** カテゴリーの表示名（削除済みのカテゴリーも名前を返す。知らない値は undefined） */
export function categoryLabel(categories: Category[], value: string): string | undefined {
  return categories.find((category) => category.value === value)?.label;
}

/**
 * 名前・value の比較用の形（前後の空白、全角半角、大文字小文字、ゼロ幅スペースなどの見えない書式文字を区別しない）
 * categories テーブルの label_key にも保存し、有効なカテゴリーの中で一意にする
 */
export function categoryMatchKey(text: string): string {
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '').trim().toLowerCase();
}

function matches(category: Category, key: string): boolean {
  return categoryMatchKey(category.value) === key || categoryMatchKey(category.label) === key;
}

function activeOf(categories: Category[]): Category[] {
  return categories.filter((category) => !category.deleted);
}

/**
 * 有効なカテゴリーを value か名前で探す（value を優先）。見つからなければ CategoryError
 */
export function findCategory(categories: Category[], input: string): Category {
  const key = categoryMatchKey(input);
  const active = activeOf(categories);
  const found =
    active.find((category) => categoryMatchKey(category.value) === key) ??
    active.find((category) => categoryMatchKey(category.label) === key);
  if (found) return found;
  const deleted = categories.find((category) => category.deleted && matches(category, key));
  const reason = deleted ? `「${deleted.label}」は削除済みです` : `「${input.trim()}」はありません`;
  const available = active.map((category) => category.label).join('、');
  throw new CategoryError(`カテゴリー${reason}（使えるカテゴリー: ${available}）。`);
}

function validLabel(label: string): string {
  const trimmed = label.trim();
  if (categoryMatchKey(trimmed).length === 0) {
    throw new CategoryError('カテゴリー名を入力してください。');
  }
  if (trimmed.length > MAX_CATEGORY_LABEL_LENGTH) {
    throw new CategoryError(`カテゴリー名は${MAX_CATEGORY_LABEL_LENGTH}文字以内にしてください。`);
  }
  if (/\p{Cc}/u.test(trimmed)) {
    throw new CategoryError('カテゴリー名に改行や制御文字は使えません。');
  }
  return trimmed;
}

export interface CategoryCreationContext {
  /** 作成日時（ISO 8601） */
  now: string;
  /** 追加するカテゴリーの value を作る（ULID など） */
  newId: () => string;
}

/**
 * カテゴリーの追加の計画
 * created: 新しく作る / restored: 削除済みの同じ名前のカテゴリーを戻す / existing: 同じ名前のカテゴリーがあるので何もしない
 */
export type CategoryCreationPlan =
  | { status: 'created' | 'restored'; category: Category; change: CategoryChange }
  | { status: 'existing'; category: Category; change: null };

/**
 * カテゴリーの追加
 * 同じ名前（か value）の有効なカテゴリーがあれば作らずにそれを返す（再試行しても重複しない）。
 * 削除済みのカテゴリーに同じ名前があれば、作らずに復元する（また選べるようになる。そのカテゴリーの支出は削除中も集計に入っている）
 */
export function planCategoryCreation(
  categories: Category[],
  label: string,
  { now, newId }: CategoryCreationContext
): CategoryCreationPlan {
  const name = validLabel(label);
  const key = categoryMatchKey(name);
  const active = activeOf(categories);
  const existing = active.find((category) => matches(category, key));
  if (existing) {
    return { status: 'existing', category: existing, change: null };
  }
  if (active.length >= MAX_ACTIVE_CATEGORIES) {
    throw new CategoryError(
      `カテゴリーは${MAX_ACTIVE_CATEGORIES}個までです。使っていないカテゴリーを削除してから追加してください。`
    );
  }
  // 同じ名前の削除済みが複数あれば、一覧の並びで最初のもの（既定 → 古い追加分）。
  // value が有効なカテゴリーの名前と重なるもの（既定の food を削除して「Food」を追加した場合など）は、戻すと区別できなくなるので戻さない
  const deleted = categories.find(
    (category) =>
      category.deleted &&
      categoryMatchKey(category.label) === key &&
      !active.some((other) => matches(other, categoryMatchKey(category.value)))
  );
  if (deleted) {
    return {
      status: 'restored',
      category: { ...deleted, label: name, deleted: false },
      change: { value: deleted.value, label: name, deletedAt: null, updatedAt: now },
    };
  }
  if (categories.filter((category) => !category.builtIn).length >= MAX_CUSTOM_CATEGORIES) {
    throw new CategoryError(
      `追加できるカテゴリーは、削除したものを含めて${MAX_CUSTOM_CATEGORIES}個までです。削除したカテゴリーは同じ名前で追加すると復元できます。`
    );
  }
  const value = newId();
  return {
    status: 'created',
    category: { value, label: name, builtIn: false, deleted: false },
    change: { value, label: name, deletedAt: null, updatedAt: now },
  };
}

/** カテゴリーの名前の変更（既定のカテゴリーも変えられる） */
export function planCategoryUpdate(
  categories: Category[],
  input: string,
  label: string,
  now: string
): { category: Category; change: CategoryChange } {
  const target = findCategory(categories, input);
  const name = validLabel(label);
  const key = categoryMatchKey(name);
  const conflict = activeOf(categories).find((category) => category.value !== target.value && matches(category, key));
  if (conflict) {
    throw new CategoryError(`「${name}」は、カテゴリー「${conflict.label}」と同じ名前になるため使えません。`);
  }
  return {
    category: { ...target, label: name },
    change: { value: target.value, label: name, deletedAt: null, updatedAt: now },
  };
}

/** カテゴリーの削除（名前は残し、過去の支出の表示名に使う） */
export function planCategoryDeletion(
  categories: Category[],
  input: string,
  now: string
): { category: Category; change: CategoryChange } {
  const target = findCategory(categories, input);
  if (target.value === FALLBACK_CATEGORY) {
    throw new CategoryError(
      `「${target.label}」はカテゴリーのない支出の計上先なので削除できません（名前は変えられます）。`
    );
  }
  return {
    category: { ...target, deleted: true },
    change: { value: target.value, label: target.label, deletedAt: now, updatedAt: now },
  };
}
