import { usePageContext } from "vike-react/usePageContext";
import "../auth.css";

/**
 * ログインページ
 * 「Googleでログイン」で認証基盤（household-auth）のログインへ進む
 */
export function Page() {
  const { urlParsed } = usePageContext();
  const failed = urlParsed.search.error !== undefined;

  return (
    <div className="auth-container">
      <h1>ログイン</h1>
      <p className="auth-description">
        Googleアカウントでログインしてください
      </p>
      {failed && (
        <p className="error-message">
          ログインできませんでした。もう一度お試しください。
        </p>
      )}
      <a
        href="/api/session/login?return_to=%2Fhousehold"
        className="google-login-button"
      >
        Googleでログイン
      </a>
    </div>
  );
}
