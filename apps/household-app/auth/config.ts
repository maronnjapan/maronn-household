import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as authSchema from "../database/drizzle/schema/auth";

/**
 * Better Authインスタンスの型
 * createAuth関数の戻り値型として使用
 */
export type Auth = ReturnType<typeof betterAuth>;

/**
 * Better Auth設定
 * メール/パスワード認証
 * DATABASE_URL環境変数経由でPostgreSQLに接続
 */

interface Env {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}

/**
 * 環境変数を検証し、必須項目が欠けている場合はエラーを投げる
 */
function validateEnv(env: Env): void {
  const requiredVars = [
    'DATABASE_URL',
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
  ] as const;

  const missing = requiredVars.filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
      'Please check your environment configuration.'
    );
  }
}

/**
 * Better Authインスタンスを取得
 *
 * @param env - Cloudflare Workers環境変数
 * @returns Better Authインスタンス
 * @throws 環境変数が不足している場合
 */
export function createAuth(env: Env): Auth {
  // 環境変数の検証
  validateEnv(env);

  // Cloudflare WorkersではI/Oオブジェクトをリクエスト間で共有できないため
  // （"Cannot perform I/O on behalf of a different request" エラー回避）、
  // リクエストごとにコネクション/Better Authインスタンスを生成する。
  const client = postgres(env.DATABASE_URL, {
    max: 5,
    fetch_types: false,
    prepare: false
  });

  const db = drizzle(client, { schema: authSchema });

  const auth = betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    trustedOrigins: [env.BETTER_AUTH_URL],
    emailAndPassword: {
      enabled: true,
    },
    user: {
      deleteUser: {
        enabled: true,
      },
    },
  });
  return auth;
}
