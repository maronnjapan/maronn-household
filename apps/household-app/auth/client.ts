import { createAuthClient } from "better-auth/react";
import { navigate } from "vike/client/router";

/**
 * Better Auth ベースURLの取得
 * 環境変数から取得し、未設定の場合はフォールバック値を使用
 *
 * Vikeの環境変数規約に従い、PUBLIC_ENV__ プレフィックスを使用
 * @see https://vike.dev/env
 */
const getBaseURL = (): string => {
  console.log('import.meta.env:', import.meta.env.PUBLIC_ENV__BETTER_AUTH_URL);
  console.log('process.env:', process?.env?.BETTER_AUTH_URL);
  console.log('window.location.origin:', typeof window !== 'undefined' ? window.location.origin : 'undefined');
  // 環境変数から取得（Vikeの規約: PUBLIC_ENV__ プレフィックス）
  // if (import.meta.env.PUBLIC_ENV__BETTER_AUTH_URL) {
  //   return import.meta.env.PUBLIC_ENV__BETTER_AUTH_URL;
  // }
  if (process?.env?.BETTER_AUTH_URL) {
    return process.env.BETTER_AUTH_URL;
  }

  // ブラウザ環境ではwindow.location.originを使用
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  throw new Error("BETTER_AUTH_URL is not defined in environment variables.");
};

/**
 * Better Auth クライアント（React用）
 * フロントエンドでセッション管理、ログイン/ログアウトを行う
 */
export const authClient = createAuthClient();

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
