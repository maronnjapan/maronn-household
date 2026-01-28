/**
 * メール送信モジュール
 *
 * Resendを使用したメール送信機能を提供
 * （AWS SESのコードは将来の切り替え用に残している）
 */

// Resend（現在使用中）
export { sendEmail, isEmailConfigured } from './mail-sender';
export type { EmailParams, ResendEnvConfig } from './mail-sender';

// AWS SES（将来の切り替え用に残す）
export { createSESClient, sendEmail as sendEmailWithSES } from './ses-client';
export type { SESConfig, SendEmailParams } from './ses-client';
