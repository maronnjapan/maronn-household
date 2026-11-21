import { useQuery } from '@tanstack/react-query';
import { categoryLabel } from '@maronn/domain/categories';
import { vanillaTrpc } from '../trpc/client';
import { DEFAULT_CATEGORIES, readCachedCategories, writeCachedCategories } from '../lib/categories';
import { useAuth } from './use-auth';

/**
 * ユーザーのカテゴリー（MCP で追加・名前変更・削除したものを含む）
 *
 * ログイン中はサーバーから取得し、端末にも保存する。オフラインや取得前は直前に保存した一覧
 * （なければ既定のカテゴリー）を使う。表示を待たせないよう、取得の完了は待たない。
 */
export function useCategories() {
  const { isAuthenticated, userId } = useAuth();
  const query = useQuery({
    queryKey: ['categories', userId],
    queryFn: async () => {
      const { categories } = await vanillaTrpc.getCategories.query();
      writeCachedCategories(userId, categories);
      return categories;
    },
    enabled: isAuthenticated,
    initialData: () => readCachedCategories(userId),
    // 保存した一覧は古いかもしれないので、ログイン中ならすぐ取り直す
    initialDataUpdatedAt: 0,
  });
  const categories = query.data ?? DEFAULT_CATEGORIES;

  return {
    /** 削除済みを含むすべてのカテゴリー（選択肢には categoryChoices で有効なものだけを使う） */
    categories,
    /** カテゴリーの表示名（削除済みのカテゴリーも名前を返す。知らない値は undefined） */
    labelOf: (value: string) => categoryLabel(categories, value),
  };
}
