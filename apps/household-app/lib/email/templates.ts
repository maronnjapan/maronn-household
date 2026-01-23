/**
 * メールテンプレート
 *
 * お問い合わせフォームなどで使用するメールテンプレートを定義
 */

export interface ContactFormData {
  name: string;
  email: string;
  subject: string;
  message: string;
}

/**
 * お問い合わせメールのテンプレートを生成
 */
export function buildContactEmailTemplate(data: ContactFormData): {
  subject: string;
  bodyText: string;
  bodyHtml: string;
} {
  const { name, email, subject, message } = data;
  const timestamp = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  const emailSubject = `【お問い合わせ】${subject}`;

  const bodyText = `
【お問い合わせ】

■ お名前
${name}

■ メールアドレス
${email}

■ 件名
${subject}

■ お問い合わせ内容
${message}

---
送信日時: ${timestamp}
`.trim();

  const bodyHtml = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>お問い合わせ</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 1.25rem;
    }
    h1 {
      color: #2c3e50;
      border-bottom: 2px solid #3498db;
      padding-bottom: 0.625rem;
      font-size: 1.5rem;
    }
    .section {
      margin-bottom: 1.25rem;
    }
    .section-title {
      font-weight: bold;
      color: #2c3e50;
      margin-bottom: 0.3125rem;
    }
    .section-content {
      background-color: #f8f9fa;
      padding: 0.75rem;
      border-radius: 0.25rem;
      white-space: pre-wrap;
    }
    .footer {
      margin-top: 1.875rem;
      padding-top: 0.9375rem;
      border-top: 1px solid #ddd;
      font-size: 0.875rem;
      color: #666;
    }
  </style>
</head>
<body>
  <h1>お問い合わせ</h1>

  <div class="section">
    <div class="section-title">お名前</div>
    <div class="section-content">${escapeHtml(name)}</div>
  </div>

  <div class="section">
    <div class="section-title">メールアドレス</div>
    <div class="section-content"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></div>
  </div>

  <div class="section">
    <div class="section-title">件名</div>
    <div class="section-content">${escapeHtml(subject)}</div>
  </div>

  <div class="section">
    <div class="section-title">お問い合わせ内容</div>
    <div class="section-content">${escapeHtml(message)}</div>
  </div>

  <div class="footer">
    送信日時: ${timestamp}
  </div>
</body>
</html>
`.trim();

  return {
    subject: emailSubject,
    bodyText,
    bodyHtml,
  };
}

/**
 * HTMLエスケープ
 */
function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
}
