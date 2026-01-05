import { authClient } from "../auth/client";

/**
 * 認証状態を管理するカスタムフック
 * Better AuthのuseSessionを使用
 */
export function useAuth() {
  const session = authClient.useSession();

  return {
    user: session.data?.user ?? null,
    session: session.data?.session ?? null,
    isLoading: session.isPending,
    isAuthenticated: !!session.data?.user,
    isError: session.isError,
    error: session.error,
  };
}
