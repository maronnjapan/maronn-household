import { createAuthClient } from "better-auth/react";
import { navigate } from "vike/client/router";

/**
 * Better Auth ベースURLの取得
 * 環境変数から取得し、未設定の場合はフォールバック値を使用
 *
 * Cloudflare Workersでは環境変数が取得できない場合があるため、
 * ブラウザ環境では window.location.origin を優先的に使用
 * @see https://vike.dev/env
 */
const getBaseURL = (): string => {
  // ブラウザ環境では window.location.origin を優先
  // （Cloudflare Workersデプロイ後も確実に動作する）
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  // サーバーサイドでは環境変数から取得
  if (import.meta.env.PUBLIC_ENV__BETTER_AUTH_URL) {
    return import.meta.env.PUBLIC_ENV__BETTER_AUTH_URL;
  }

  // フォールバック: ローカル開発環境
  return 'http://localhost:3000';
};

/**
 * Better Auth クライアント（React用）
 * フロントエンドでセッション管理、ログイン/ログアウトを行う
 */
export const authClient = createAuthClient({
  baseURL: getBaseURL() + "/api/auth",
});

/**
 * メール/パスワードでサインアップ
 */
export const signUp = async (email: string, password: string, name: string) => {
  return await authClient.signUp.email({
    email,
    password,
    name,
  });
};

/**
 * メール/パスワードでサインイン
 */
export const signIn = async (email: string, password: string) => {
  return await authClient.signIn.email({
    email,
    password,
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
