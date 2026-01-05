import { createAuthClient } from "better-auth/react";
import { navigate } from "vike/client/router";

/**
 * Better Auth ベースURLの取得
 * 環境変数から取得し、未設定の場合はフォールバック値を使用
 */
const getBaseURL = (): string => {
  // 環境変数から取得（Viteの場合は VITE_BETTER_AUTH_URL）
  if (import.meta.env.VITE_BETTER_AUTH_URL) {
    return import.meta.env.VITE_BETTER_AUTH_URL;
  }

  // ブラウザ環境ではwindow.location.originを使用
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  // サーバーサイドレンダリング時のフォールバック
  return 'http://localhost:5173';
};

/**
 * Better Auth クライアント（React用）
 * フロントエンドでセッション管理、ログイン/ログアウトを行う
 */
export const authClient = createAuthClient({
  baseURL: getBaseURL(),
});

/**
 * ログイン用のヘルパー関数
 */
export const signIn = {
  /**
   * Auth0でログイン
   * OAuth連携の開始に失敗した場合はユーザーにフィードバックを提供
   */
  auth0: async () => {
    try {
      await authClient.signIn.social({
        provider: "auth0",
        callbackURL: "/household",
      });
    } catch (error) {
      console.error("Failed to initiate Auth0 sign-in:", error);
      if (typeof window !== "undefined") {
        window.alert("ログインを開始できませんでした。しばらく待ってから再度お試しください。");
      }
    }
  },
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
        // エラー時もホームページにリダイレクト
        window.location.href = "/";
      },
    },
  });
};
