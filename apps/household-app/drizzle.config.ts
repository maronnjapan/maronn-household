import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit設定
 *
 * 使い分け:
 * - 認証データ（PostgreSQL）: DRIZZLE_TARGET=auth を指定
 * - 支出・予算データ（D1）: DRIZZLE_TARGET=household を指定（デフォルト）
 *
 * 使用例:
 * ```bash
 * # D1スキーマのマイグレーション生成
 * DRIZZLE_TARGET=household pnpm drizzle-kit generate
 *
 * # 認証スキーマのマイグレーション生成
 * DRIZZLE_TARGET=auth pnpm drizzle-kit generate
 * ```
 */

const target = process.env.DRIZZLE_TARGET || "household";

if (target === "auth") {
  // 認証用テーブル（PostgreSQL / Supabase）
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required for PostgreSQL migrations. " +
      "Please set it in your .env file."
    );
  }

  export default defineConfig({
    dialect: "postgresql",
    schema: "./database/drizzle/schema/auth.ts",
    out: "./database/migrations/auth",
    dbCredentials: {
      // マイグレーション生成時はSupabaseの直接接続文字列を使用
      // 実行時はHyperdriveを使用（wrangler経由）
      url: process.env.DATABASE_URL,
    },
  });
} else {
  // 支出・予算データ（D1 / SQLite）
  // D1はwrangler経由で実行するため、dbCredentialsは不要
  export default defineConfig({
    dialect: "sqlite",
    schema: "./database/drizzle/schema/household.ts",
    out: "./database/migrations/household",
  });
}
