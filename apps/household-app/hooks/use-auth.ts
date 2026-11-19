import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SESSION_QUERY_KEY, fetchSessionUser, rememberedUserId } from '../auth/client';
import { ANONYMOUS_USER_ID, migrateAnonymousExpenses } from '../lib/db';
import { syncPendingExpenses } from '../lib/sync';

/**
 * 認証状態を管理するカスタムフック（ログインは認証基盤 household-auth、状態は /api/session/me）
 *
 * userIdはIndexedDBのデータ分離に使用:
 * - 認証時: 実際のユーザーID
 * - 確認中・オフライン: 最後にログインしていたユーザーID（ローカルのデータをすぐ表示するため）
 * - 未認証: ANONYMOUS_USER_ID ('anonymous')
 *
 * セッション取得完了後、匿名データを自動的に認証ユーザーに移行
 */
export function useAuth() {
  const session = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSessionUser,
    staleTime: 5 * 60 * 1000,
  });
  const user = session.data ?? null;
  const isAuthenticated = user !== null;
  const wasLoadingRef = useRef<boolean>(true);
  const hasMigratedRef = useRef<boolean>(false);

  const authenticatedUserId = user?.id ?? null;
  const unconfirmedUserId = session.isPending || session.isError ? rememberedUserId() : null;

  // 認証情報取得完了時のマイグレーション処理
  // wasLoading: true -> isPending: false への遷移を検知
  if (wasLoadingRef.current && !session.isPending && authenticatedUserId && !hasMigratedRef.current) {
    hasMigratedRef.current = true;
    // 非同期でマイグレーション実行（UIをブロックしない）
    migrateAnonymousExpenses(authenticatedUserId)
      .then((count) => {
        if (count > 0) {
          // 移行したデータをサーバーに同期
          return syncPendingExpenses(authenticatedUserId);
        }
      })
      .catch(console.error);
  }

  // 現在のロード状態を記録
  wasLoadingRef.current = session.isPending;

  return {
    userId: authenticatedUserId ?? unconfirmedUserId ?? ANONYMOUS_USER_ID,
    user,
    isLoading: session.isPending,
    isAuthenticated,
    isError: session.isError,
    error: session.error,
  };
}
