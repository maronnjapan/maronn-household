import { useState } from "react";
import { forgetPassword } from "../../../auth/client";
import "../auth.css";

export function Page() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isEmailSent, setIsEmailSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const result = await forgetPassword(email);

    if (result.error) {
      setError(result.error.message ?? "メールの送信に失敗しました");
      setIsLoading(false);
      return;
    }

    setIsEmailSent(true);
    setIsLoading(false);
  };

  if (isEmailSent) {
    return (
      <div className="auth-container">
        <h1>メールを送信しました</h1>
        <p className="auth-message">
          入力されたメールアドレスにパスワードリセット用のリンクを送信しました。
          メールをご確認ください。
        </p>
        <p className="auth-note">
          メールが届かない場合は、迷惑メールフォルダもご確認ください。
        </p>
        <p className="auth-link">
          <a href="/auth/login">ログインページに戻る</a>
        </p>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <h1>パスワードをお忘れの方</h1>
      <p className="auth-description">
        登録したメールアドレスを入力してください。
        パスワードリセット用のリンクをお送りします。
      </p>
      <form onSubmit={handleSubmit} className="auth-form">
        <div className="form-group">
          <label htmlFor="email">メールアドレス</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        {error && <p className="error-message">{error}</p>}
        <button type="submit" disabled={isLoading}>
          {isLoading ? "送信中..." : "リセットメールを送信"}
        </button>
      </form>
      <p className="auth-link">
        <a href="/auth/login">ログインページに戻る</a>
      </p>
    </div>
  );
}
