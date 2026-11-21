import { sqliteTable, text, integer, real, index, primaryKey } from 'drizzle-orm/sqlite-core';

export const expenses = sqliteTable(
  'expenses',
  {
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
    /** レシートから按分された支出の場合のレシートID（手入力はnull） */
    receiptId: text('receipt_id'),
  },
  (table) => [
    index('expenses_user_date_idx').on(table.userId, table.date),
    index('expenses_receipt_id_idx').on(table.receiptId),
  ]
);

export const budgets = sqliteTable(
  'budgets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    month: text('month').notNull(),
    amount: integer('amount').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('budgets_user_month_idx').on(table.userId, table.month)]
);

/**
 * レシート（生成AIがレシート写真を読み取って登録する購入記録）
 * 予算計算に使う支出は expenses にカテゴリ別に按分して保存し、receiptId で紐づける
 */
export const receipts = sqliteTable(
  'receipts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    storeName: text('store_name').notNull(),
    /** 購入日時（ISO 8601） */
    purchasedAt: text('purchased_at').notNull(),
    /** 支払総額（税込・値引き後） */
    totalAmount: integer('total_amount').notNull(),
    taxAmount: integer('tax_amount'),
    paymentMethod: text('payment_method'),
    /** 登録元クライアント */
    source: text('source').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('receipts_user_purchased_at_idx').on(table.userId, table.purchasedAt)]
);

export const receiptItems = sqliteTable(
  'receipt_items',
  {
    id: text('id').primaryKey(),
    receiptId: text('receipt_id')
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    /** レシート上の並び順（0始まり） */
    position: integer('position').notNull(),
    name: text('name').notNull(),
    /** 行の金額（数量×単価） */
    amount: integer('amount').notNull(),
    quantity: real('quantity'),
    category: text('category'),
  },
  (table) => [index('receipt_items_receipt_id_idx').on(table.receiptId)]
);

/**
 * 支出カテゴリーの、ユーザーごとの変更（追加したカテゴリーと、既定のカテゴリーの名前変更・削除）
 * そのユーザーのカテゴリーの一覧は、@maronn/domain の resolveCategories で既定のカテゴリーと重ねて作る
 */
export const categories = sqliteTable(
  'categories',
  {
    userId: text('user_id').notNull(),
    /** 支出・レシート明細の category に保存する値（既定のカテゴリーは 'food' など、追加したカテゴリーは ULID） */
    value: text('value').notNull(),
    label: text('label').notNull(),
    /** 削除日時（削除しても過去の支出の表示名に使うため、行は残す） */
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.value] })]
);

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
