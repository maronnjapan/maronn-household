import { drizzle } from 'drizzle-orm/d1';
import { users, expenses, budgets } from '../../src/db/schema';

/**
 * テストデータをクリーンアップ
 * テーブルのデータを削除（テーブル自体は維持）
 */
export async function cleanupTestData(db: D1Database) {
  const drizzleDb = drizzle(db);

  // 外部キー制約があるため、順序に注意
  await drizzleDb.delete(expenses).run();
  await drizzleDb.delete(budgets).run();
  await drizzleDb.delete(users).run();
}

/**
 * デフォルトユーザーを作成
 */
export async function createDefaultUser(db: D1Database) {
  const drizzleDb = drizzle(db);

  await drizzleDb
    .insert(users)
    .values({
      id: 'default-user',
      createdAt: new Date().toISOString(),
    })
    .run();
}
