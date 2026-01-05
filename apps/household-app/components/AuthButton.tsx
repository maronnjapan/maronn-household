import { useAuth } from "../hooks/use-auth";
import { signIn, signOut } from "../auth/client";
import styles from "./AuthButton.module.css";

/**
 * ログイン/ログアウトボタンコンポーネント
 * 認証状態に応じて表示を切り替える
 */
export function AuthButton() {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <button disabled className={styles.button}>
        読込中...
      </button>
    );
  }

  if (isAuthenticated) {
    return (
      <button onClick={signOut} className={styles.button}>
        ログアウト
      </button>
    );
  }

  return (
    <button onClick={signIn.auth0} className={styles.button}>
      Auth0でログイン
    </button>
  );
}
