import { useState } from "react";
import { navigate } from "vike/client/router";
import { signIn } from "../../../auth/client";
import "../auth.css";

export function Page() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const result = await signIn(email, password);

    if (result.error) {
      setError(result.error.message ?? "ログインに失敗しました");
      setIsLoading(false);
      return;
    }

    await navigate("/household");
  };

  return (
    <div className="auth-container">
      <h1>ログイン</h1>
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
            autoComplete="current-password"
          />
        </div>
        {error && <p className="error-message">{error}</p>}
        <button type="submit" disabled={isLoading}>
          {isLoading ? "ログイン中..." : "ログイン"}
        </button>
      </form>
      <p className="auth-link">
        アカウントをお持ちでない方は<a href="/auth/signup">新規登録</a>
      </p>
    </div>
  );
}
