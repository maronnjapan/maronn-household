import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as authSchema from "../database/drizzle/schema/auth";

/**
 * Better Authインスタンスの型
 * createAuth関数の戻り値型として使用
 */
export type Auth = ReturnType<typeof betterAuth>;

/**
 * Better Auth設定
 * Googleログイン認証のみ
 * Cloudflare D1を使用（SQLite）
 */

interface Env {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  // Google OAuth設定
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

/**
 * 環境変数を検証し、必須項目が欠けている場合はエラーを投げる
 */
function validateEnv(env: Env): void {
  const requiredVars = [
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
  ] as const;

  const missing = requiredVars.filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
      'Please check your environment configuration.'
    );
  }

  if (!env.DB) {
    throw new Error(
      'D1 database binding (DB) is not configured. ' +
      'Please check your wrangler.jsonc configuration.'
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

  // D1データベースに接続
  const db = drizzle(env.DB, { schema: authSchema });

  const auth = betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: authSchema,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    trustedOrigins: [env.BETTER_AUTH_URL],
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    user: {
      deleteUser: {
        enabled: true,
      },
    },
  });
  return auth;
}
