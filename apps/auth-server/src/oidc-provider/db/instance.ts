/**
 * OP のデータベース（ユーザー所有のファイル。CLI の再生成でも上書きされない）
 *
 * Cloudflare D1（household-db）を使う。テーブルは apps/household-app/database/migrations の
 * 0008_oidc_provider.sql（db/schema.sql と同じ内容）で wrangler d1 migrations が作る。
 */
import type { Context } from 'hono';
import type { SqlDatabase, SqlStatement } from './database.js';

export function createDatabase(c: Context): SqlDatabase {
  return d1Database(c.env.DB as D1Database);
}

export function d1Database(d1: D1Database): SqlDatabase {
  return {
    async all<Row>(statement: SqlStatement): Promise<Row[]> {
      const result = await d1.prepare(statement.sql).bind(...statement.params).all<Row>();
      return result.results;
    },
    async run(statement: SqlStatement) {
      const result = await d1.prepare(statement.sql).bind(...statement.params).run();
      return { changes: result.meta.changes };
    },
  };
}
