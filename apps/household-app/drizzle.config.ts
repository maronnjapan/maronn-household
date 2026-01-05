import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// 認証用テーブル（PostgreSQL）のマイグレーション設定
// 支出・予算データ（D1）は別途 wrangler d1 migrations で管理
export default defineConfig({
  dialect: "postgresql",
  schema: "./database/drizzle/schema/auth.ts", // 認証スキーマのみ
  out: "./database/migrations/auth", // 認証用マイグレーション
  dbCredentials: {
    // マイグレーション生成時はSupabaseの直接接続文字列を使用
    // 実行時はHyperdriveを使用（wrangler経由）
    url: process.env.DATABASE_URL || "",
  },
});
