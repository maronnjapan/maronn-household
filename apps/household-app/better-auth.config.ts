import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as authSchema from "./database/drizzle/schema/auth";

/**
 * Better Auth CLI用の設定ファイル
 * 型生成などCLI操作で使用
 *
 * 注意: 本番環境ではauth/config.tsのcreateAuth()を使用すること
 * このファイルはローカル開発でのCLI操作（型生成等）専用
 */

// ローカル開発用のSQLiteデータベースを使用
const sqlite = new Database(":memory:");
const db = drizzle(sqlite, { schema: authSchema });

export const auth: ReturnType<typeof betterAuth> = betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
    socialProviders: {
        google: {
            clientId: "dummy-for-cli",
            clientSecret: "dummy-for-cli",
        },
    },
});
