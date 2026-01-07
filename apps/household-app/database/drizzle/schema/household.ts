import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const expenses = sqliteTable('expenses', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull(),
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
  userId: text('user_id')
    .notNull(),
  month: text('month').notNull(),
  amount: integer('amount').notNull(),
  updatedAt: text('updated_at').notNull(),
});
