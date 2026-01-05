import { useCallback } from "react";
import { useAuth } from "../hooks/use-auth";
import { signIn, signOut } from "../auth/client";
import styles from "./AuthButton.module.css";

/**
 * ログイン/ログアウトボタンコンポーネント
 * 認証状態に応じて表示を切り替える
 */
export function AuthButton() {
  const { isLoading, isAuthenticated, isError, error } = useAuth();

  // パフォーマンス最適化のためuseCallbackでメモ化
  const handleSignIn = useCallback(async () => {
    await signIn.auth0();
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOut();
  }, []);

  // セッション取得エラー時の表示
  if (isError) {
    return (
      <button disabled className={styles.button} title={error?.message}>
        エラー
      </button>
    );
  }

  // 読込中の表示
  if (isLoading) {
    return (
      <button disabled className={styles.button}>
        読込中...
      </button>
    );
  }

  // ログイン済みの場合
  if (isAuthenticated) {
    return (
      <button onClick={handleSignOut} className={styles.button}>
        ログアウト
      </button>
    );
  }

  // 未ログインの場合
  return (
    <button onClick={handleSignIn} className={styles.button}>
      Auth0でログイン
    </button>
  );
}
