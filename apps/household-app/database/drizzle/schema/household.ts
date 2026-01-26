import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const expenses = sqliteTable('expenses', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  amount: integer('amount').notNull(),
  category: text('category'),
  memo: text('memo'),
  date: text('date').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deviceId: text('device_id').notNull(),
});

export const budgets = sqliteTable('budgets', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  month: text('month').notNull(),
  amount: integer('amount').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const apiTokens = sqliteTable('api_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name'),
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at'),
  isActive: integer('is_active').notNull().default(1),
});

export const apiUsage = sqliteTable('api_usage', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  month: text('month').notNull(),
  count: integer('count').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  url: text('url').notNull(),
  secretEncrypted: text('secret_encrypted'),
  secretIv: text('secret_iv'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * バウンス・コンプレイントメールアドレス記録テーブル
 * SESからのバウンス・コンプレイント通知を受信した際に記録
 * メール送信前にこのテーブルをチェックして送信を抑制する
 */
export const emailBounces = sqliteTable('email_bounces', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  bounceType: text('bounce_type').notNull(), // 'bounce' or 'complaint'
  bounceSubType: text('bounce_sub_type'), // 'Permanent', 'Transient', 'Undetermined' for bounce
  sourceEmail: text('source_email'), // 送信元メールアドレス
  feedbackId: text('feedback_id'), // AWS SESのFeedback ID
  rawMessage: text('raw_message'), // 元のSNSメッセージ（JSON）
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
