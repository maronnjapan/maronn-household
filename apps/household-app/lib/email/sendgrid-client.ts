/**
 * SendGrid クライアント
 *
 * SendGrid Web API v3を使用してメールを送信する
 * Cloudflare Workers互換（fetch APIを使用）
 */

export interface SendGridConfig {
  apiKey: string;
}

export interface SendGridEmailParams {
  to: string;
  from: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  replyTo?: string;
}

interface SendGridMailRequest {
  personalizations: Array<{
    to: Array<{ email: string }>;
  }>;
  from: { email: string };
  reply_to?: { email: string };
  subject: string;
  content: Array<{
    type: string;
    value: string;
  }>;
}

/**
 * SendGrid経由でメールを送信
 */
export async function sendEmailWithSendGrid(
  config: SendGridConfig,
  params: SendGridEmailParams
): Promise<void> {
  const { to, from, subject, bodyText, bodyHtml, replyTo } = params;

  const content: Array<{ type: string; value: string }> = [
    { type: 'text/plain', value: bodyText },
  ];

  if (bodyHtml) {
    content.push({ type: 'text/html', value: bodyHtml });
  }

  const requestBody: SendGridMailRequest = {
    personalizations: [
      {
        to: [{ email: to }],
      },
    ],
    from: { email: from },
    subject,
    content,
  };

  if (replyTo) {
    requestBody.reply_to = { email: replyTo };
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `SendGrid API error: ${response.status} ${response.statusText} - ${errorBody}`
    );
  }
}
