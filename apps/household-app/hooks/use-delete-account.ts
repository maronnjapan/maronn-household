import { useState, useCallback } from "react";
import { navigate } from "vike/client/router";
import { trpc } from "../trpc/client";
import { deleteAccount } from "../auth/client";
import { clearUserData, ANONYMOUS_USER_ID } from "../lib/db";
import { useAuth } from "./use-auth";

interface DeleteAccountState {
  isDeleting: boolean;
  error: string | null;
}

/**
 * アカウント削除処理を管理するカスタムフック
 *
 * 削除順序:
 * 1. 認証データ削除（BetterAuth経由、D1のuser/session/accountテーブル）
 * 2. 家計データ削除（tRPC経由、D1のexpenses/budgets等）
 * 3. IndexedDBクリア
 * 4. トップページへリダイレクト
 */
export function useDeleteAccount() {
  const { userId, isAuthenticated } = useAuth();
  const [state, setState] = useState<DeleteAccountState>({
    isDeleting: false,
    error: null,
  });

  const deleteAccountMutation = trpc.deleteAccountData.useMutation();

  const handleDeleteAccount = useCallback(async () => {
    if (!isAuthenticated) {
      setState({ isDeleting: false, error: "ログインが必要です" });
      return;
    }

    setState({ isDeleting: true, error: null });

    // Step 1: 認証データ削除（BetterAuth経由）
    const authResult = await deleteAccount();
    if (authResult.error) {
      setState({
        isDeleting: false,
        error: authResult.error.message ?? "アカウントの削除に失敗しました",
      });
      return;
    }

    // Step 2: D1データ削除
    const d1Result = await deleteAccountMutation.mutateAsync();
    if (!d1Result.success) {
      setState({ isDeleting: false, error: "データの削除に失敗しました" });
      return;
    }

    // Step 3: IndexedDBクリア（退会ユーザー + 匿名ユーザーのデータを削除）
    await clearUserData(userId);
    await clearUserData(ANONYMOUS_USER_ID);

    // Step 4: リダイレクト
    await navigate("/");

    setState({ isDeleting: false, error: null });
  }, [isAuthenticated, userId, deleteAccountMutation]);

  return {
    deleteAccount: handleDeleteAccount,
    isDeleting: state.isDeleting,
    error: state.error,
  };
}
