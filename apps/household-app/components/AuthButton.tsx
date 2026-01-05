import { useAuth } from "../hooks/use-auth";
import { signIn, signOut } from "../auth/client";

/**
 * ログイン/ログアウトボタンコンポーネント
 * 認証状態に応じて表示を切り替える
 */
export function AuthButton() {
  const { user, isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <button disabled style={styles.button}>
        読込中...
      </button>
    );
  }

  if (isAuthenticated && user) {
    return (
      <div style={styles.container}>
        <span style={styles.username}>
          {user.name || user.email}
        </span>
        <button onClick={signOut} style={styles.button}>
          ログアウト
        </button>
      </div>
    );
  }

  return (
    <button onClick={signIn.auth0} style={styles.button}>
      Auth0でログイン
    </button>
  );
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  username: {
    fontSize: '0.875rem',
    color: '#666',
  },
  button: {
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    border: '1px solid #ddd',
    borderRadius: '0.375rem',
    backgroundColor: '#fff',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
};
