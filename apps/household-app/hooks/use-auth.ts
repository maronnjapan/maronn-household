import { useRef } from 'react';
import { authClient } from "../auth/client";
import { ANONYMOUS_USER_ID, migrateAnonymousExpenses } from "../lib/db";
import { syncPendingExpenses } from "../lib/sync";

/**
 * 認証状態を管理するカスタムフック
 * Better AuthのuseSessionを使用
 *
 * userIdはIndexedDBのデータ分離に使用:
 * - 認証時: 実際のユーザーID
 * - 未認証時 / 認証情報取得中: ANONYMOUS_USER_ID ('anonymous')
 *
 * セッション取得完了後、匿名データを自動的に認証ユーザーに移行
 */
export function useAuth() {
  const session = authClient.useSession();
  const isAuthenticated = !!session.data?.user;
  const wasLoadingRef = useRef<boolean>(true);
  const hasMigratedRef = useRef<boolean>(false);

  const authenticatedUserId = isAuthenticated ? session.data!.user.id : null;

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
    userId: authenticatedUserId ?? ANONYMOUS_USER_ID,
    isLoading: session.isPending,
    isAuthenticated,
    isError: !!session.error,
    error: session.error,
  };
}
