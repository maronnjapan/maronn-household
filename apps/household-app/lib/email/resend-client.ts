/**
 * Resend API クライアント
 *
 * ResendのHTTP APIを使ってメールを送信する。
 * Cloudflare Workersのfetch APIで動作するようシンプルなラッパーを提供。
 */

export interface ResendConfig {
  apiKey: string;
}

export interface ResendEmailParams {
  to: string;
  from: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  replyTo?: string;
}

interface ResendMailRequest {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  reply_to?: string;
}

/**
 * Resend経由でメールを送信する。
 */
export async function sendEmailWithResend(
  config: ResendConfig,
  params: ResendEmailParams
): Promise<void> {
  const { to, from, subject, bodyText, bodyHtml, replyTo } = params;

  const requestBody: ResendMailRequest = {
    from,
    to,
    subject,
    text: bodyText,
  };

  if (bodyHtml) {
    requestBody.html = bodyHtml;
  }

  if (replyTo) {
    requestBody.reply_to = replyTo;
  }

  const response = await fetch('https://api.resend.com/emails', {
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
      `Resend API error: ${response.status} ${response.statusText} - ${errorBody}`
    );
  }
}
