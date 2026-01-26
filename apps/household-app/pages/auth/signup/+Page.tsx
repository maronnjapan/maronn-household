import { useState } from "react";
import { navigate } from "vike/client/router";
import { signUp } from "../../../auth/client";
import "../auth.css";

export function Page() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("パスワードは8文字以上で入力してください");
      return;
    }

    if (!agreedToPrivacy) {
      setError("利用規約とプライバシーポリシーに同意してください");
      return;
    }

    setIsLoading(true);

    try {
      const result = await signUp(email, password);

      if (result.error) {
        setError(result.error.message ?? "登録に失敗しました");
        return;
      }

      await navigate("/household");
    } catch (err) {
      console.error("Error during signup or navigation", err);
      setError("登録後の画面遷移に失敗しました。もう一度お試しください。");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <h1>新規登録</h1>
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
        <div className="form-group">
          <label htmlFor="password">パスワード</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <div className="form-group checkbox-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={agreedToPrivacy}
              onChange={(e) => {
                console.log(e.target.checked);
                setAgreedToPrivacy(e.target.checked);
              }}
              required
            />

          </label>
          <span>
            <a
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              利用規約
            </a>
            と
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              プライバシーポリシー
            </a>
            に同意します
          </span>
        </div>
        {error && <p className="error-message">{error}</p>}
        <button type="submit" disabled={isLoading}>
          {isLoading ? "登録中..." : "登録"}
        </button>
      </form>
      <p className="auth-link">
        既にアカウントをお持ちの方は<a href="/auth/login">ログイン</a>
      </p>
    </div>
  );
}
