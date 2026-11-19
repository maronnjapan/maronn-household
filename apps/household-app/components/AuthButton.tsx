import { useAuth } from "../hooks/use-auth";
import { signOut } from "../auth/client";
import styles from "./AuthButton.module.css";

/**
 * ログイン/ログアウトボタンコンポーネント
 * 認証状態に応じて表示を切り替える
 */
export function AuthButton() {
  const { isLoading, isAuthenticated } = useAuth();

  // 読込中の表示
  if (isLoading) {
    return <span className={styles.button}>読込中...</span>;
  }

  // ログイン済みの場合
  if (isAuthenticated) {
    return (
      <button onClick={() => signOut()} className={styles.button}>
        ログアウト
      </button>
    );
  }

  // 未ログイン（セッションを確認できない場合を含む）
  return (
    <a href="/auth/login" className={styles.button}>
      ログイン
    </a>
  );
}
