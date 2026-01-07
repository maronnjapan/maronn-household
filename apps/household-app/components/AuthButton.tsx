import { useCallback } from "react";
import { useAuth } from "../hooks/use-auth";
import { signOut } from "../auth/client";
import styles from "./AuthButton.module.css";

/**
 * ログイン/ログアウトボタンコンポーネント
 * 認証状態に応じて表示を切り替える
 */
export function AuthButton() {
  const { isLoading, isAuthenticated, isError, error } = useAuth();

  const handleSignOut = useCallback(async () => {
    await signOut();
  }, []);

  // セッション取得エラー時の表示
  if (isError) {
    return (
      <a href="/auth/login" className={styles.button} title={error?.message}>
        ログイン
      </a>
    );
  }

  // 読込中の表示
  if (isLoading) {
    return (
      <span className={styles.button}>
        読込中...
      </span>
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
    <a href="/auth/login" className={styles.button}>
      ログイン
    </a>
  );
}
