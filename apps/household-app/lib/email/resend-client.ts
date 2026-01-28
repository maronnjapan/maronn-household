import { Resend } from 'resend';

/**
 * Resend API クライアント
 *
 * Resend公式のnpmパッケージを使ってメールを送信する。
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

/**
 * Resend経由でメールを送信する。
 */
export async function sendEmailWithResend(
  config: ResendConfig,
  params: ResendEmailParams
): Promise<void> {
  const resend = new Resend(config.apiKey);
  const { to, from, subject, bodyText, bodyHtml, replyTo } = params;

  const payload = {
    from,
    to,
    subject,
    text: bodyText,
    ...(bodyHtml ? { html: bodyHtml } : {}),
    ...(replyTo ? { replyTo } : {}),
  };

  const { error } = await resend.emails.send(payload);

  if (error) {
    const { name, statusCode, message } = error;
    throw new Error(
      `Resend API error: ${name ?? 'unknown'} (${statusCode ?? 'no-status'}) - ${message}`
    );
  }
}
