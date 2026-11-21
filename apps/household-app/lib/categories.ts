/**
 * アプリでのカテゴリーの扱い（select の選択肢、端末に保存する直前の一覧）
 *
 * カテゴリーの追加・名前変更・削除は MCP サーバーで行い、アプリはサーバーの一覧（getCategories）を表示と選択に使う。
 * オフラインでも追加したカテゴリーを表示・選択できるよう、直前に取得した一覧を localStorage に保存する。
 */
import { resolveCategories, type Category } from '@maronn/domain/categories';

/** ログインしていない、または一覧がまだないときのカテゴリー（既定のカテゴリー） */
export const DEFAULT_CATEGORIES: Category[] = resolveCategories([]);

export interface CategoryChoice {
  value: string;
  label: string;
}

/**
 * select の選択肢（有効なカテゴリー）
 * 選んでいる値が選択肢にないときは、select の表示が実際の値とずれないよう、その値も加える。
 * 削除済みと分かっていれば「名前（削除済み）」、分からなければ（CSV から取り込んだ値や、一覧の取得前の追加カテゴリー）値そのもの
 */
export function categoryChoices(categories: Category[], selected: string): CategoryChoice[] {
  const choices = categories
    .filter((category) => !category.deleted)
    .map(({ value, label }) => ({ value, label }));
  if (!selected || choices.some((choice) => choice.value === selected)) {
    return choices;
  }
  const known = categories.find((category) => category.value === selected);
  return [...choices, { value: selected, label: known ? `${known.label}（削除済み）` : selected }];
}

/** 直前に取得した一覧（最後のユーザーの分だけ保存する） */
const CACHE_KEY = 'household:categories';

interface CategoryCache {
  userId: string;
  categories: Category[];
}

export function serializeCategoryCache(userId: string, categories: Category[]): string {
  return JSON.stringify({ userId, categories } satisfies CategoryCache);
}

/** 保存した一覧（そのユーザーのものでなければ、壊れていれば undefined） */
export function parseCategoryCache(raw: string | null, userId: string): Category[] | undefined {
  if (raw === null) return undefined;
  let cache: unknown;
  try {
    cache = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return isCategoryCache(cache) && cache.userId === userId ? cache.categories : undefined;
}

function isCategoryCache(value: unknown): value is CategoryCache {
  if (typeof value !== 'object' || value === null) return false;
  const { userId, categories } = value as Record<string, unknown>;
  return typeof userId === 'string' && Array.isArray(categories) && categories.every(isCategory);
}

function isCategory(value: unknown): value is Category {
  if (typeof value !== 'object' || value === null) return false;
  const { value: categoryValue, label, builtIn, deleted } = value as Record<string, unknown>;
  return (
    typeof categoryValue === 'string' &&
    typeof label === 'string' &&
    typeof builtIn === 'boolean' &&
    typeof deleted === 'boolean'
  );
}

/** 端末に保存した直前の一覧（ストレージを使えない環境やサーバーでは undefined） */
export function readCachedCategories(userId: string): Category[] | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return parseCategoryCache(window.localStorage.getItem(CACHE_KEY), userId);
  } catch {
    return undefined;
  }
}

export function writeCachedCategories(userId: string, categories: Category[]): void {
  try {
    window.localStorage.setItem(CACHE_KEY, serializeCategoryCache(userId, categories));
  } catch {
    // ストレージを使えない環境（プライベートブラウズなど）では保存しない
  }
}

/** 退会後: 保存した一覧を消す */
export function clearCachedCategories(): void {
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // ストレージを使えない環境では、もともと保存していない
  }
}
