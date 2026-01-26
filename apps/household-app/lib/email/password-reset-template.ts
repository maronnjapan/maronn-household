/**
 * パスワードリセット用メールテンプレート
 */

export interface PasswordResetEmailData {
  url: string;
}

export function buildPasswordResetEmailTemplate(data: PasswordResetEmailData): {
  text: string;
  html: string;
} {
  const { url } = data;

  const text = `パスワードリセットのご依頼を受け付けました。

以下のリンクからパスワードをリセットしてください。

${url}

このリンクは24時間有効です。

心当たりがない場合は、このメールを無視してください。

---
家計簿アプリ`;

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>パスワードリセット</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f9fafb; border-radius: 8px; padding: 32px;">
    <h1 style="color: #111827; font-size: 24px; margin-bottom: 24px;">パスワードリセット</h1>

    <p style="margin-bottom: 16px;">パスワードリセットのご依頼を受け付けました。</p>

    <p style="margin-bottom: 24px;">以下のボタンをクリックして、新しいパスワードを設定してください。</p>

    <div style="text-align: center; margin-bottom: 24px;">
      <a href="${url}" style="display: inline-block; background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">パスワードをリセット</a>
    </div>

    <p style="color: #6b7280; font-size: 14px; margin-bottom: 16px;">ボタンが機能しない場合は、以下のURLをブラウザに貼り付けてください。</p>

    <p style="color: #6b7280; font-size: 14px; word-break: break-all; margin-bottom: 24px;">${url}</p>

    <p style="color: #6b7280; font-size: 14px; margin-bottom: 8px;">このリンクは24時間有効です。</p>

    <p style="color: #9ca3af; font-size: 12px;">心当たりがない場合は、このメールを無視してください。</p>
  </div>

  <div style="text-align: center; margin-top: 24px; color: #9ca3af; font-size: 12px;">
    <p>家計簿アプリ</p>
  </div>
</body>
</html>`;

  return { text, html };
}
