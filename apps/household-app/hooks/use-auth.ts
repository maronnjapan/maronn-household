import { authClient } from "../auth/client";

/**
 * 認証状態を管理するカスタムフック
 * Better AuthのuseSessionを使用
 *
 * 注: 現時点ではユーザー情報をフロントエンドに公開する必要がないため、
 * 認証状態（isAuthenticated）のみを提供します。
 * 将来的にユーザー情報が必要になった場合は、userプロパティを追加してください。
 */
export function useAuth() {
  const session = authClient.useSession();

  return {
    // user: session.data?.user ?? null, // 将来必要になったら有効化
    isLoading: session.isPending,
    isAuthenticated: !!session.data?.user,
    isError: session.isError,
    error: session.error,
  };
}
