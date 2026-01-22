/**
 * AWS SES クライアント
 *
 * AWS SDK v3を使用してメールを送信する
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

export interface SESConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SendEmailParams {
  to: string;
  from: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  replyTo?: string;
}

/**
 * SESクライアントを作成
 */
export function createSESClient(config: SESConfig): SESClient {
  return new SESClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

/**
 * AWS SES経由でメールを送信
 */
export async function sendEmail(
  client: SESClient,
  params: SendEmailParams
): Promise<void> {
  const { to, from, subject, bodyText, bodyHtml, replyTo } = params;

  const command = new SendEmailCommand({
    Source: from,
    Destination: {
      ToAddresses: [to],
    },
    Message: {
      Subject: {
        Data: subject,
        Charset: 'UTF-8',
      },
      Body: {
        Text: {
          Data: bodyText,
          Charset: 'UTF-8',
        },
        ...(bodyHtml && {
          Html: {
            Data: bodyHtml,
            Charset: 'UTF-8',
          },
        }),
      },
    },
    ...(replyTo && {
      ReplyToAddresses: [replyTo],
    }),
  });

  await client.send(command);
}
