import { describe, it, expect } from 'vitest';
import { createTestDatabase, splitStatements } from '../src/index';

describe('createTestDatabase', () => {
  it('すべてのマイグレーションを適用した D1 を作る（家計簿・Better Auth・レシート・認証基盤・カテゴリーのテーブル、支出の内訳）', async () => {
    const { db, dispose } = await createTestDatabase();
    const { results } = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all<{ name: string }>();
    const tables = results.map((row) => row.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        'expenses',
        'budgets',
        'user',
        'account',
        'session',
        'receipts',
        'receipt_items',
        'clients',
        'transactions',
        'access_tokens',
        'browser_sessions',
        'categories',
      ])
    );
    const { results: columns } = await db.prepare('PRAGMA table_info(expenses)').all<{ name: string }>();
    expect(columns.map((column) => column.name)).toContain('items');
    await dispose();
  }, 60_000);
});

describe('splitStatements', () => {
  it('コメントを除いて文ごとに分ける', () => {
    expect(
      splitStatements(`-- header\nCREATE TABLE a (\n  x text -- note\n);\n--> statement-breakpoint\nCREATE INDEX i ON a (x);\n`)
    ).toEqual(['CREATE TABLE a (\n  x text \n)', 'CREATE INDEX i ON a (x)']);
  });
});
