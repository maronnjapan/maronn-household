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
 * 本番環境: Hyperdrive経由でPostgreSQLに接続
 * ローカル開発: DATABASE_URL環境変数で直接接続
 */

interface Env {
  DATABASE_URL?: string;  // ローカル開発用
  HYPERDRIVE?: Hyperdrive;  // 本番環境用
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}

/**
 * 環境変数を検証し、必須項目が欠けている場合はエラーを投げる
 */
function validateEnv(env: Env): void {
  const requiredVars = [
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

  // DATABASE_URL または HYPERDRIVE のどちらかが必要
  if (!env.HYPERDRIVE && !env.DATABASE_URL) {
    throw new Error(
      'Database connection not available. ' +
      'Set DATABASE_URL in .dev.vars (local) or configure HYPERDRIVE (production).'
    );
  }
}

/**
 * 環境に応じてデータベース接続文字列を取得
 * 本番環境: Hyperdrive経由
 * ローカル開発: DATABASE_URL直接
 */
function getConnectionString(env: Env): string {
  // 本番環境: Hyperdriveを使用
  if (env.HYPERDRIVE) {
    return env.HYPERDRIVE.connectionString;
  }
  // ローカル開発: DATABASE_URLを直接使用
  return env.DATABASE_URL!;
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
  const connectionString = getConnectionString(env);
  const client = postgres(connectionString, {
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
