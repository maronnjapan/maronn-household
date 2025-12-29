import { applyD1Migrations, env } from 'cloudflare:test';

// テスト環境のD1データベースにマイグレーションを適用
const migrations = env.TEST_MIGRATIONS;
await applyD1Migrations(env.DB, migrations);
