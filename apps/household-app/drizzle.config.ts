import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./database/drizzle/schema/*",
  out: "./database/migrations",
  dbCredentials: {
    // マイグレーション生成時はSupabaseの直接接続文字列を使用
    // 実行時はHyperdriveを使用（wrangler経由）
    url: process.env.DATABASE_URL || "",
  },
});
