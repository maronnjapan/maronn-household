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
  if (!config.apiKey) {
    throw new Error("Resend API key is missing. Check RESEND_API_KEY.");
  }
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

  console.info(`Resend send attempt. to=${to} from=${from} subject=${subject}`);
  const { data, error } = await resend.emails.send(payload);

  if (error) {
    const { name, statusCode, message } = error;
    throw new Error(
      `Resend API error: ${name ?? 'unknown'} (${statusCode ?? 'no-status'}) - ${message}`
    );
  }

  if (!data?.id) {
    console.warn(
      "Resend API response did not include an email id. Check the dashboard for delivery status."
    );
    return;
  }

  console.info(`Resend email accepted. id=${data.id} to=${to}`);
}
