/**
 * メール送信の共通インターフェース
 *
 * ResendとAWS SESを切り替え可能にするための抽象化層
 * 現在はResendをデフォルトで使用
 */

import { sendEmailWithResend } from './resend-client';
import type { ResendConfig, ResendEmailParams } from './resend-client';

// AWS SESのインポート（将来の切り替え用に残す）
// import { createSESClient, sendEmail as sendEmailWithSES } from './ses-client';
// import type { SESConfig, SendEmailParams as SESEmailParams } from './ses-client';

export interface EmailParams {
  to: string;
  from: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  replyTo?: string;
}

export interface ResendEnvConfig {
  RESEND_API_KEY: string;
}

// AWS SES用の設定（将来の切り替え用）
// export interface SESEnvConfig {
//   AWS_SES_REGION: string;
//   AWS_ACCESS_KEY_ID: string;
//   AWS_SECRET_ACCESS_KEY: string;
// }

/**
 * Resendでメールを送信
 */
export async function sendEmail(
  config: ResendEnvConfig,
  params: EmailParams
): Promise<void> {
  const resendConfig: ResendConfig = {
    apiKey: config.RESEND_API_KEY,
  };

  const resendParams: ResendEmailParams = {
    to: params.to,
    from: params.from,
    subject: params.subject,
    bodyText: params.bodyText,
    bodyHtml: params.bodyHtml,
    replyTo: params.replyTo,
  };

  await sendEmailWithResend(resendConfig, resendParams);
}

/**
 * Resend設定が有効かどうかをチェック
 */
export function isEmailConfigured(config: Partial<ResendEnvConfig>): boolean {
  return Boolean(config.RESEND_API_KEY);
}

// AWS SESを使用する場合のコード（将来の切り替え用に残す）
// export async function sendEmailViaSES(
//   config: SESEnvConfig,
//   params: EmailParams
// ): Promise<void> {
//   const sesClient = createSESClient({
//     region: config.AWS_SES_REGION,
//     accessKeyId: config.AWS_ACCESS_KEY_ID,
//     secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
//   });
//
//   await sendEmailWithSES(sesClient, {
//     to: params.to,
//     from: params.from,
//     subject: params.subject,
//     bodyText: params.bodyText,
//     bodyHtml: params.bodyHtml,
//     replyTo: params.replyTo,
//   });
// }
