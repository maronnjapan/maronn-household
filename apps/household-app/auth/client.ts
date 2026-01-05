import { createAuthClient } from "better-auth/react";
import { navigate } from "vike/client/router";

/**
 * Better Auth クライアント（React用）
 * フロントエンドでセッション管理、ログイン/ログアウトを行う
 */
export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
});

/**
 * ログイン用のヘルパー関数
 */
export const signIn = {
  /**
   * Auth0でログイン
   */
  auth0: () => {
    authClient.signIn.social({
      provider: "auth0",
      callbackURL: "/household",
    });
  },
};

/**
 * ログアウト用のヘルパー関数
 * Vikeのルーターナビゲーションを使用してページリロードを回避
 */
export const signOut = async () => {
  try {
    await authClient.signOut();
    // Vikeのクライアントサイドナビゲーションを使用
    await navigate("/");
  } catch (error) {
    console.error("Sign out error:", error);
    // エラー時はフォールバックとしてページリロード
    window.location.href = "/";
  }
};
