/**
 * テスト用のローカル D1（Miniflare / workerd の本物の D1 実装）
 *
 * apps/household-app/database/migrations の SQL を番号順にすべて適用した、
 * 本番と同じスキーマの空のデータベースを作る。モックではなく実際の D1 で検証するために使う。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';

export const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../apps/household-app/database/migrations'
);

export interface TestDatabase {
  db: D1Database;
  dispose(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response(null, { status: 404 }); } }',
    d1Databases: { DB: crypto.randomUUID() },
    compatibilityDate: '2026-01-03',
  });
  const db = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const file of migrationFiles()) {
    const statements = splitStatements(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    for (const statement of statements) {
      await db.prepare(statement).run();
    }
  }
  return { db, dispose: () => mf.dispose() };
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

/** コメントを除き、`;` で文に分ける（マイグレーションの SQL は文字列リテラルに `;` や `--` を含まない） */
export function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
