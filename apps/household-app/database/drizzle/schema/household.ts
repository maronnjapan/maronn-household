import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * サポートする通貨
 */
export type CurrencyCode = 'JPY' | 'USD' | 'EUR';

/**
 * 定期支出（繰り返し支出）テーブル
 * 毎月自動で支出を生成するためのテンプレート
 */
export const recurringExpenses = sqliteTable('recurring_expenses', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  amount: integer('amount').notNull(), // 円換算後の金額
  category: text('category'),
  memo: text('memo'),
  dayOfMonth: integer('day_of_month').notNull(), // 1-31（月末を超える場合は月末に調整）
  isActive: integer('is_active').notNull().default(1),
  lastGeneratedMonth: text('last_generated_month'), // 最後に支出を生成した月（YYYY-MM）
  // 通貨関連（外貨建てサブスク対応）
  currency: text('currency').$type<CurrencyCode>().default('JPY'), // 'JPY' | 'USD' | 'EUR'
  originalAmount: integer('original_amount'), // 元の通貨での金額（USDならセント単位）
  lastExchangeRate: text('last_exchange_rate'), // 最後に使用した為替レート（JSON: {"rate": 150.5, "date": "2024-01-15"}）
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * 予算アラート設定テーブル
 * 残額が閾値を下回ったときに警告を表示
 */
export const budgetAlerts = sqliteTable('budget_alerts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  thresholdPercent: integer('threshold_percent').notNull(), // 予算の何%で警告（例: 20 = 残り20%）
  thresholdAmount: integer('threshold_amount'), // 金額ベースの閾値（オプション）
  isEnabled: integer('is_enabled').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

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
