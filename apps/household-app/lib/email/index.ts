/**
 * メール送信モジュール
 *
 * SendGridを使用したメール送信機能とテンプレートを提供
 * （AWS SESのコードは将来の切り替え用に残している）
 */

// SendGrid（現在使用中）
export { sendEmail, isEmailConfigured } from './mail-sender';
export type { EmailParams, SendGridEnvConfig } from './mail-sender';

// AWS SES（将来の切り替え用に残す）
export { createSESClient, sendEmail as sendEmailWithSES } from './ses-client';
export type { SESConfig, SendEmailParams } from './ses-client';

// テンプレート
export { buildContactEmailTemplate } from './templates';
export type { ContactFormData } from './templates';
