import { useMemo, useState } from 'react';
import { trpc } from '../trpc/client';

const MAX_WEBHOOKS = 5;

const WEBHOOK_EXAMPLE_BODY = {
  event: 'expense.created',
  occurredAt: '2026-01-15T12:34:56.789Z',
  userId: 'user_123',
  expense: {
    id: 'expense_abc',
    amount: 1280,
    category: '食費',
    memo: 'スーパー',
    date: '2026-01-15',
    createdAt: '2026-01-15T12:34:56.789Z',
    updatedAt: '2026-01-15T12:34:56.789Z',
    deviceId: 'device_xyz',
  },
};

/**
 * Webhook設定セクション
 */
export function WebhookSection() {
  const [showForm, setShowForm] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.listWebhooks.useQuery();
  const createWebhookMutation = trpc.createWebhook.useMutation({
    onSuccess: () => {
      setUrl('');
      setSecret('');
      setShowForm(false);
      setErrorMessage('');
      utils.listWebhooks.invalidate();
    },
    onError: (error) => {
      setErrorMessage(error.message || '保存に失敗しました');
    },
  });
  const deleteWebhookMutation = trpc.deleteWebhook.useMutation({
    onSuccess: () => {
      utils.listWebhooks.invalidate();
    },
  });

  const webhookCount = data?.webhooks.length ?? 0;
  const canAddMore = webhookCount < MAX_WEBHOOKS;
  const exampleBody = useMemo(
    () => JSON.stringify(WEBHOOK_EXAMPLE_BODY, null, 2),
    []
  );

  function handleCreate() {
    createWebhookMutation.mutate({
      url,
      secret: secret || undefined,
    });
  }

  function handleDelete(id: string) {
    if (confirm('このWebhookを削除しますか？')) {
      deleteWebhookMutation.mutate({ id });
    }
  }

  return (
    <section className="settings-section">
      <h2>Webhook</h2>
      <p className="settings-description">
        支出の登録が完了すると、登録したURLにPOSTリクエストを送信します。
      </p>
      <p className="webhook-limit-note">
        ※最大{MAX_WEBHOOKS}件まで登録可能です
      </p>
      <p className="webhook-secret-note">
        シークレットは暗号化して保存され、署名ヘッダーとして送信されます。
      </p>

      <div className="webhook-example">
        <button
          type="button"
          onClick={() => setShowExample((prev) => !prev)}
          className="toggle-example-button"
        >
          {showExample
            ? 'Webhookリクエスト例を隠す'
            : 'Webhookリクエスト例を表示'}
        </button>
        {showExample && (
          <pre className="webhook-example-body">{exampleBody}</pre>
        )}
      </div>

      {!showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="issue-token-button"
          disabled={!canAddMore}
        >
          Webhookを追加
        </button>
      )}

      {!canAddMore && (
        <p className="webhook-limit-warning">登録上限に達しています。</p>
      )}

      {showForm && (
        <div className="issue-token-form webhook-form">
          <label>
            Webhook URL:
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/webhook"
              required
            />
          </label>
          <label>
            シークレット（任意）:
            <input
              type="text"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="署名に使うシークレット"
            />
          </label>
          {errorMessage && (
            <p className="error-message" style={{ color: 'red' }}>
              {errorMessage}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              onClick={handleCreate}
              disabled={createWebhookMutation.isPending || !url}
            >
              {createWebhookMutation.isPending ? '保存中...' : '保存'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setUrl('');
                setSecret('');
                setErrorMessage('');
              }}
              className="cancel-button"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      <h3>登録済みWebhook</h3>
      {isLoading ? (
        <p>読込中...</p>
      ) : data?.webhooks && data.webhooks.length > 0 ? (
        <ul className="token-list webhook-list">
          {data.webhooks.map((hook) => (
            <li key={hook.id}>
              <div className="token-info">
                <strong>{hook.url}</strong>
                <span className="token-date">
                  登録: {new Date(hook.createdAt).toLocaleDateString('ja-JP')}
                </span>
                {hook.hasSecret && (
                  <span className="webhook-secret-status">
                    シークレット設定済み
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(hook.id)}
                disabled={deleteWebhookMutation.isPending}
                className="revoke-button"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>Webhookが登録されていません。</p>
      )}
    </section>
  );
}
