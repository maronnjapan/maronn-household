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
  subBudgetId: text('sub_budget_id'),
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

export const subBudgets = sqliteTable('sub_budgets', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  amount: integer('amount').notNull(),
  startMonth: text('start_month').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const subBudgetMonthlyAmounts = sqliteTable('sub_budget_monthly_amounts', {
  id: text('id').primaryKey(),
  subBudgetId: text('sub_budget_id').notNull(),
  userId: text('user_id').notNull(),
  month: text('month').notNull(),
  amount: integer('amount').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  url: text('url').notNull(),
  secretEncrypted: text('secret_encrypted'),
  secretIv: text('secret_iv'),
  customHeaders: text('custom_headers'),
  customHeadersIv: text('custom_headers_iv'),
  bodyTemplate: text('body_template'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const webhookBatchSchedules = sqliteTable('webhook_batch_schedules', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  webhookId: text('webhook_id').notNull(),
  scheduleType: text('schedule_type').notNull(), // 'hourly' | 'daily' | 'weekly' | 'monthly'
  minute: integer('minute').notNull().default(0),
  hour: integer('hour'),
  dayOfWeek: integer('day_of_week'),
  dayOfMonth: integer('day_of_month'),
  bodyTemplate: text('body_template'),
  customHeaders: text('custom_headers'),
  customHeadersIv: text('custom_headers_iv'),
  isActive: integer('is_active').notNull().default(1),
  lastExecutedAt: text('last_executed_at'),
  nextExecutionAt: text('next_execution_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
