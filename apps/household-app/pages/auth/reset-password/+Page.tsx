import { useState } from "react";
import { navigate } from "vike/client/router";
import { usePageContext } from "vike-react/usePageContext";
import { resetPassword } from "../../../auth/client";
import "../auth.css";

export function Page() {
  const pageContext = usePageContext();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // URLからトークンを取得
  const token = pageContext.urlParsed.search.token as string | undefined;
  const urlError = pageContext.urlParsed.search.error as string | undefined;

  // トークンがない場合またはURLにエラーがある場合
  if (!token || urlError) {
    return (
      <div className="auth-container">
        <h1>リンクが無効です</h1>
        <p className="auth-description">
          {urlError === "INVALID_TOKEN"
            ? "パスワードリセットのリンクが無効または期限切れです。"
            : "パスワードリセットのリンクが無効です。"}
          <br />
          もう一度パスワードリセットをお試しください。
        </p>
        <p className="auth-link">
          <a href="/auth/forgot-password">パスワードリセットを再度リクエスト</a>
        </p>
        <p className="auth-link">
          <a href="/auth/login">ログインページに戻る</a>
        </p>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("パスワードは8文字以上で入力してください");
      return;
    }

    if (password !== confirmPassword) {
      setError("パスワードが一致しません");
      return;
    }

    setIsLoading(true);

    const result = await resetPassword(password, token);

    if (result.error) {
      setError(result.error.message ?? "パスワードのリセットに失敗しました");
      setIsLoading(false);
      return;
    }

    setIsSuccess(true);
    setIsLoading(false);
  };

  const handleGoToLogin = async () => {
    await navigate("/auth/login");
  };

  if (isSuccess) {
    return (
      <div className="auth-container">
        <h1>パスワードを変更しました</h1>
        <p className="auth-message">
          パスワードが正常に変更されました。
          新しいパスワードでログインしてください。
        </p>
        <button onClick={handleGoToLogin} className="auth-button">
          ログインページへ
        </button>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <h1>新しいパスワードを設定</h1>
      <form onSubmit={handleSubmit} className="auth-form">
        <div className="form-group">
          <label htmlFor="password">新しいパスワード</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="8文字以上"
          />
        </div>
        <div className="form-group">
          <label htmlFor="confirmPassword">パスワード（確認）</label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="もう一度入力"
          />
        </div>
        {error && <p className="error-message">{error}</p>}
        <button type="submit" disabled={isLoading}>
          {isLoading ? "変更中..." : "パスワードを変更"}
        </button>
      </form>
      <p className="auth-link">
        <a href="/auth/login">ログインページに戻る</a>
      </p>
    </div>
  );
}
