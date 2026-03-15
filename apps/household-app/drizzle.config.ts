import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit設定
 *
 * 使い分け:
 * - 認証データ（D1/SQLite）: DRIZZLE_TARGET=auth を指定
 * - 支出・予算データ（D1/SQLite）: DRIZZLE_TARGET=household を指定（デフォルト）
 *
 * 使用例:
 * ```bash
 * # D1 householdスキーマのマイグレーション生成
 * DRIZZLE_TARGET=household pnpm drizzle-kit generate
 *
 * # D1 authスキーマのマイグレーション生成
 * DRIZZLE_TARGET=auth pnpm drizzle-kit generate
 * ```
 *
 * 注意: 認証データもCloudflare D1（SQLite）に移行済み
 */

const target = process.env.DRIZZLE_TARGET || "household";

let config = null;

if (target === "auth") {
  // 認証用テーブル（D1 / SQLite）
  config = defineConfig({
    dialect: "sqlite",
    schema: "../../packages/db-schema/src/auth.ts",
    out: "./database/migrations/auth/",
  });
} else {
  // 支出・予算データ（D1 / SQLite）
  config = defineConfig({
    dialect: "sqlite",
    schema: "../../packages/db-schema/src/household.ts",
    out: "./database/migrations/",
  });
}

export default config;
