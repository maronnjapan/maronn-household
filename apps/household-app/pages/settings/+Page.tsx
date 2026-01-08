import { useAuth } from "../../hooks/use-auth";
import { DeleteAccountSection } from "../../components/DeleteAccountSection";
import "./settings.css";

/**
 * 設定ページ
 * 認証済みユーザーのみアクセス可能
 * 退会機能を含む
 */
export function Page() {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <main className="settings-page">
        <h1>設定</h1>
        <p>読込中...</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="settings-page">
        <h1>設定</h1>
        <p className="settings-login-required">
          設定を表示するには<a href="/auth/login">ログイン</a>してください。
        </p>
      </main>
    );
  }

  return (
    <main className="settings-page">
      <h1>設定</h1>
      <DeleteAccountSection />
    </main>
  );
}
