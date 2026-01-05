import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * 家計簿アプリ用のスキーマ（PostgreSQL版）
 * 認証はauth.tsのuserテーブルを使用
 */

export const expenses = pgTable('expenses', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
  category: text('category'),
  memo: text('memo'),
  date: timestamp('date').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deviceId: text('device_id').notNull(),
});

export const budgets = pgTable('budgets', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  month: text('month').notNull(),
  amount: integer('amount').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
