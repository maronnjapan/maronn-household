import { useState } from "react";
import { signInWithGoogle } from "../../../auth/client";
import "../auth.css";

export function Page() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setError(null);
    setIsLoading(true);

    const result = await signInWithGoogle();

    if (result.error) {
      setError(result.error.message ?? "ログインに失敗しました");
      setIsLoading(false);
    }
    // 成功時はGoogleの認証ページにリダイレクトされるため、
    // setIsLoading(false)は不要
  };

  return (
    <div className="auth-container">
      <h1>ログイン</h1>
      <p className="auth-description">
        Googleアカウントでログインしてください
      </p>
      {error && <p className="error-message">{error}</p>}
      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={isLoading}
        className="google-login-button"
      >
        {isLoading ? "ログイン中..." : "Googleでログイン"}
      </button>
    </div>
  );
}
