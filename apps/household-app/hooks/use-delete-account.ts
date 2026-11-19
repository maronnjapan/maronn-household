import { useState } from "react";
import { navigate } from "vike/client/router";
import { useQueryClient } from "@tanstack/react-query";
import { trpc } from "../trpc/client";
import { SESSION_QUERY_KEY, forgetUser } from "../auth/client";
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
 * 1. サーバー（tRPC deleteAccount）: 家計データ → 認証基盤のユーザー・ログインの記録。セッション Cookie も消える
 * 2. IndexedDBクリア
 * 3. トップページへリダイレクト
 */
export function useDeleteAccount() {
  const { userId, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [state, setState] = useState<DeleteAccountState>({
    isDeleting: false,
    error: null,
  });

  const deleteAccountMutation = trpc.deleteAccount.useMutation();

  const handleDeleteAccount = async () => {
    if (!isAuthenticated) {
      setState({ isDeleting: false, error: "ログインが必要です" });
      return;
    }

    setState({ isDeleting: true, error: null });

    try {
      await deleteAccountMutation.mutateAsync();
    } catch {
      setState({ isDeleting: false, error: "アカウントの削除に失敗しました" });
      return;
    }

    // IndexedDBクリア（退会ユーザー + 匿名ユーザーのデータを削除）
    await clearUserData(userId);
    await clearUserData(ANONYMOUS_USER_ID);
    forgetUser();
    await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });

    await navigate("/");
    setState({ isDeleting: false, error: null });
  };

  return {
    deleteAccount: handleDeleteAccount,
    isDeleting: state.isDeleting,
    error: state.error,
  };
}
