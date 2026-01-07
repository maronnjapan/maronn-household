import { authClient } from "../auth/client";
import { ANONYMOUS_USER_ID } from "../lib/db";

/**
 * 認証状態を管理するカスタムフック
 * Better AuthのuseSessionを使用
 *
 * userIdはIndexedDBのデータ分離に使用:
 * - 認証時: 実際のユーザーID
 * - 未認証時: ANONYMOUS_USER_ID ('anonymous')
 */
export function useAuth() {
  const session = authClient.useSession();
  const isAuthenticated = !!session.data?.user;

  return {
    userId: isAuthenticated ? session.data!.user.id : ANONYMOUS_USER_ID,
    isLoading: session.isPending,
    isAuthenticated,
    isError: !!session.error,
    error: session.error,
  };
}
