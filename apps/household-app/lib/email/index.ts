/**
 * メール送信モジュール
 *
 * AWS SESを使用したメール送信機能とテンプレートを提供
 */

export { createSESClient, sendEmail } from './ses-client';
export type { SESConfig, SendEmailParams } from './ses-client';

export { buildContactEmailTemplate } from './templates';
export type { ContactFormData } from './templates';
