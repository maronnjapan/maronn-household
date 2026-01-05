import { createAuthClient } from "better-auth/react";

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
 */
export const signOut = async () => {
  await authClient.signOut({
    fetchOptions: {
      onSuccess: () => {
        window.location.href = "/";
      },
    },
  });
};
