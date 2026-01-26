/**
 * AWS SES バウンス・コンプレイント Webhook ハンドラー
 *
 * SNS経由でSESからのバウンス・コンプレイント通知を受け取り、
 * email_bouncesテーブルに記録する
 */

import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { emailBounces } from '../database/drizzle/schema/household';
import { ulid } from 'ulidx';

interface Env {
  DB: D1Database;
}

/**
 * SNSメッセージの型定義
 */
interface SNSMessage {
  Type: 'SubscriptionConfirmation' | 'Notification' | 'UnsubscribeConfirmation';
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  SubscribeURL?: string; // SubscriptionConfirmationの場合
  Token?: string; // SubscriptionConfirmationの場合
}

/**
 * SESバウンス通知の型定義
 */
interface SESBounceNotification {
  notificationType: 'Bounce';
  bounce: {
    bounceType: 'Permanent' | 'Transient' | 'Undetermined';
    bounceSubType: string;
    bouncedRecipients: Array<{
      emailAddress: string;
      action?: string;
      status?: string;
      diagnosticCode?: string;
    }>;
    timestamp: string;
    feedbackId: string;
    reportingMTA?: string;
  };
  mail: {
    timestamp: string;
    source: string;
    sourceArn: string;
    sendingAccountId: string;
    messageId: string;
    destination: string[];
  };
}

/**
 * SESコンプレイント通知の型定義
 */
interface SESComplaintNotification {
  notificationType: 'Complaint';
  complaint: {
    complainedRecipients: Array<{
      emailAddress: string;
    }>;
    timestamp: string;
    feedbackId: string;
    complaintSubType?: string;
    complaintFeedbackType?: string;
  };
  mail: {
    timestamp: string;
    source: string;
    sourceArn: string;
    sendingAccountId: string;
    messageId: string;
    destination: string[];
  };
}

type SESNotification = SESBounceNotification | SESComplaintNotification;

/**
 * SNSサブスクリプション確認を処理
 */
async function handleSubscriptionConfirmation(
  subscribeUrl: string
): Promise<void> {
  // SNSからの確認URLにアクセスしてサブスクリプションを確認
  const response = await fetch(subscribeUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to confirm subscription: ${response.status} ${response.statusText}`
    );
  }
  console.log('[SES Webhook] Subscription confirmed successfully');
}

/**
 * バウンス通知を処理してDBに記録
 */
async function handleBounceNotification(
  db: ReturnType<typeof drizzle>,
  notification: SESBounceNotification,
  rawMessage: string
): Promise<void> {
  const now = new Date().toISOString();

  for (const recipient of notification.bounce.bouncedRecipients) {
    await db
      .insert(emailBounces)
      .values({
        id: ulid(),
        email: recipient.emailAddress.toLowerCase(),
        bounceType: 'bounce',
        bounceSubType: notification.bounce.bounceType,
        sourceEmail: notification.mail.source,
        feedbackId: notification.bounce.feedbackId,
        rawMessage,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    console.log(
      `[SES Webhook] Bounce recorded: ${recipient.emailAddress} (${notification.bounce.bounceType})`
    );
  }
}

/**
 * コンプレイント通知を処理してDBに記録
 */
async function handleComplaintNotification(
  db: ReturnType<typeof drizzle>,
  notification: SESComplaintNotification,
  rawMessage: string
): Promise<void> {
  const now = new Date().toISOString();

  for (const recipient of notification.complaint.complainedRecipients) {
    await db
      .insert(emailBounces)
      .values({
        id: ulid(),
        email: recipient.emailAddress.toLowerCase(),
        bounceType: 'complaint',
        bounceSubType: notification.complaint.complaintSubType || null,
        sourceEmail: notification.mail.source,
        feedbackId: notification.complaint.feedbackId,
        rawMessage,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    console.log(
      `[SES Webhook] Complaint recorded: ${recipient.emailAddress}`
    );
  }
}

/**
 * SES Webhookハンドラーを作成
 */
export function sesWebhookHandler(basePath: string) {
  const app = new Hono<{ Bindings: Env }>();

  // バウンス通知エンドポイント
  app.post(`${basePath}/bounce`, async (c) => {
    const body = await c.req.text();
    let snsMessage: SNSMessage;

    try {
      snsMessage = JSON.parse(body) as SNSMessage;
    } catch {
      console.error('[SES Webhook] Invalid JSON body');
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    // SNSサブスクリプション確認
    if (snsMessage.Type === 'SubscriptionConfirmation') {
      if (!snsMessage.SubscribeURL) {
        return c.json({ error: 'Missing SubscribeURL' }, 400);
      }
      await handleSubscriptionConfirmation(snsMessage.SubscribeURL);
      return c.json({ message: 'Subscription confirmed' }, 200);
    }

    // 通知メッセージの処理
    if (snsMessage.Type === 'Notification') {
      let notification: SESNotification;
      try {
        notification = JSON.parse(snsMessage.Message) as SESNotification;
      } catch {
        console.error('[SES Webhook] Invalid notification message');
        return c.json({ error: 'Invalid notification message' }, 400);
      }

      if (notification.notificationType === 'Bounce') {
        const db = drizzle(c.env.DB);
        await handleBounceNotification(
          db,
          notification as SESBounceNotification,
          snsMessage.Message
        );
      }

      return c.json({ message: 'Notification processed' }, 200);
    }

    return c.json({ message: 'Message type not handled' }, 200);
  });

  // コンプレイント通知エンドポイント
  app.post(`${basePath}/complaint`, async (c) => {
    const body = await c.req.text();
    let snsMessage: SNSMessage;

    try {
      snsMessage = JSON.parse(body) as SNSMessage;
    } catch {
      console.error('[SES Webhook] Invalid JSON body');
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    // SNSサブスクリプション確認
    if (snsMessage.Type === 'SubscriptionConfirmation') {
      if (!snsMessage.SubscribeURL) {
        return c.json({ error: 'Missing SubscribeURL' }, 400);
      }
      await handleSubscriptionConfirmation(snsMessage.SubscribeURL);
      return c.json({ message: 'Subscription confirmed' }, 200);
    }

    // 通知メッセージの処理
    if (snsMessage.Type === 'Notification') {
      let notification: SESNotification;
      try {
        notification = JSON.parse(snsMessage.Message) as SESNotification;
      } catch {
        console.error('[SES Webhook] Invalid notification message');
        return c.json({ error: 'Invalid notification message' }, 400);
      }

      if (notification.notificationType === 'Complaint') {
        const db = drizzle(c.env.DB);
        await handleComplaintNotification(
          db,
          notification as SESComplaintNotification,
          snsMessage.Message
        );
      }

      return c.json({ message: 'Notification processed' }, 200);
    }

    return c.json({ message: 'Message type not handled' }, 200);
  });

  return app;
}
