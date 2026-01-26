import { useState } from 'react';
import { trpc } from '../trpc/client';

/**
 * APIトークン管理セクション
 */
export function ApiTokenSection() {
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const { data: tokensData, isLoading } = trpc.listApiTokens.useQuery();
  const issueTokenMutation = trpc.issueApiToken.useMutation({
    onSuccess: (data) => {
      setIssuedToken(data.token);
      setTokenName('');
      setShowIssueForm(false);
      utils.listApiTokens.invalidate();
    },
  });
  const revokeTokenMutation = trpc.revokeApiToken.useMutation({
    onSuccess: () => {
      utils.listApiTokens.invalidate();
    },
  });

  function handleIssueToken() {
    issueTokenMutation.mutate({ name: tokenName || undefined });
  }

  function handleRevokeToken(tokenHash: string) {
    if (confirm('このトークンを無効化しますか？')) {
      revokeTokenMutation.mutate({ tokenHash });
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    alert('クリップボードにコピーしました');
  }

  return (
    <section className="settings-section">
      <h2>APIトークン</h2>
      <p>月次家計簿データをJSON形式でエクスポートするためのAPIトークンを管理します。</p>
      <p className="api-limit-note">※一日50回まで利用可能です</p>

      {issuedToken && (
        <div className="issued-token-alert">
          <p>
            <strong>トークンが発行されました！</strong>
          </p>
          <p className="token-warning">
            このトークンは再表示できません。安全に保管してください。
          </p>
          <div className="token-display">
            <code>{issuedToken}</code>
            <button
              type="button"
              onClick={() => copyToClipboard(issuedToken)}
              className="copy-button"
            >
              コピー
            </button>
          </div>
          <button
            type="button"
            onClick={() => setIssuedToken(null)}
            className="close-button"
          >
            閉じる
          </button>
        </div>
      )}

      {!showIssueForm && (
        <button
          type="button"
          onClick={() => setShowIssueForm(true)}
          className="issue-token-button"
        >
          新しいトークンを発行
        </button>
      )}

      {showIssueForm && (
        <div className="issue-token-form">
          <label>
            トークン名（任意）:
            <input
              type="text"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder="例: iPhoneショートカット"
            />
          </label>
          <div className="form-actions">
            <button
              type="button"
              onClick={handleIssueToken}
              disabled={issueTokenMutation.isPending}
            >
              {issueTokenMutation.isPending ? '発行中...' : '発行'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowIssueForm(false);
                setTokenName('');
              }}
              className="cancel-button"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      <h3>発行済みトークン</h3>
      {isLoading ? (
        <p>読込中...</p>
      ) : tokensData?.tokens && tokensData.tokens.filter((token) => token.isActive === 1).length > 0 ? (
        <ul className="token-list">
          {tokensData.tokens
            .filter((token) => token.isActive === 1)
            .map((token) => (
              <li key={token.tokenHash}>
                <div className="token-info">
                  <strong>{token.name || '（名前なし）'}</strong>
                  <span className="token-date">
                    作成: {new Date(token.createdAt).toLocaleDateString('ja-JP')}
                  </span>
                  {token.lastUsedAt && (
                    <span className="token-date">
                      最終使用: {new Date(token.lastUsedAt).toLocaleDateString('ja-JP')}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRevokeToken(token.tokenHash)}
                  disabled={revokeTokenMutation.isPending}
                  className="revoke-button"
                >
                  無効化
                </button>
              </li>
            ))}
        </ul>
      ) : (
        <p>トークンが発行されていません。</p>
      )}

      <div className="api-usage-guide">
        <h3>API使用方法</h3>
        <pre>
{`GET /api/v1/export/monthly?month=YYYY-MM
Authorization: Bearer <your_token>`}
        </pre>
        <p>例: 2026年1月のデータをエクスポート</p>
        <pre>
{`curl -H "Authorization: Bearer <your_token>" \\
  "https://your-domain.com/api/v1/export/monthly?month=2026-01"`}
        </pre>
      </div>
    </section>
  );
}
