import { useAuth } from "../hooks/use-auth";
import { signIn, signOut } from "../auth/client";
import styles from "./AuthButton.module.css";

/**
 * ログイン/ログアウトボタンコンポーネント
 * 認証状態に応じて表示を切り替える
 */
export function AuthButton() {
  const { user, isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <button disabled className={styles.button}>
        読込中...
      </button>
    );
  }

  if (isAuthenticated && user) {
    return (
      <div className={styles.container}>
        <span className={styles.username}>
          {user.name || user.email}
        </span>
        <button onClick={signOut} className={styles.button}>
          ログアウト
        </button>
      </div>
    );
  }

  return (
    <button onClick={signIn.auth0} className={styles.button}>
      Auth0でログイン
    </button>
  );
}
