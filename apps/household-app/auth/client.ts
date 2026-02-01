import { createAuthClient } from "better-auth/react";
import { navigate } from "vike/client/router";

/**
 * Better Auth クライアント（React用）
 * フロントエンドでセッション管理、ログイン/ログアウトを行う
 */
export const authClient = createAuthClient();

/**
 * Googleでサインイン
 * OAuthフローを開始し、Google認証ページにリダイレクト
 */
export const signInWithGoogle = async () => {
  return await authClient.signIn.social({
    provider: "google",
    callbackURL: "/household",
  });
};

/**
 * ログアウト用のヘルパー関数
 * onSuccessコールバック内でVikeのナビゲーションを実行
 */
export const signOut = async () => {
  await authClient.signOut({
    fetchOptions: {
      onSuccess: async () => {
        // ログアウト成功後にクライアントサイドナビゲーション
        try {
          await navigate("/");
        } catch (error) {
          console.error("Navigation error after sign out:", error);
          // ナビゲーション失敗時はページリロード
          window.location.href = "/";
        }
      },
      onError: (error) => {
        console.error("Sign out error:", error);
        // エラー時はリダイレクトせず、ユーザーにエラーを通知
        if (typeof window !== "undefined") {
          window.alert("ログアウトに失敗しました。時間をおいて再度お試しください。");
        }
      },
    },
  });
};

/**
 * アカウント削除用のヘルパー関数
 * BetterAuthのdeleteUser APIを呼び出す
 * D1データの削除はtRPC経由で事前に行う必要がある
 */
export const deleteAccount = async () => {
  return await authClient.deleteUser({
    fetchOptions: {
      onSuccess: () => {
        console.log("User account deleted successfully");
      },
      onError: (error) => {
        console.error("Delete account error:", error);
      },
    },
  });
};
