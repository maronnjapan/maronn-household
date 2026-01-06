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
 * Hyperdrive経由でSupabase PostgreSQLに接続
 */

interface Env {
  HYPERDRIVE: Hyperdrive;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}

/**
 * 環境変数を検証し、必須項目が欠けている場合はエラーを投げる
 */
function validateEnv(env: Env): void {
  const requiredVars = [
    'HYPERDRIVE',
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
 * Better Authインスタンスのキャッシュ（モジュールレベルのシングルトン）
 *
 * WeakMapは使用しない理由:
 * Cloudflare Workersではリクエストごとに異なるenvオブジェクトインスタンスが渡されるため、
 * オブジェクト参照の等価性に依存するWeakMapではキャッシュが機能しない。
 *
 * 代わりに、モジュールレベルのシングルトンパターンを使用。
 * Better Authインスタンスは環境変数が変わらない限り再利用可能。
 */
let cachedAuth: Auth | null = null;

/**
 * Better Authインスタンスを取得（キャッシュ済みの場合は再利用）
 *
 * @param env - Cloudflare Workers環境変数
 * @returns Better Authインスタンス
 * @throws 環境変数が不足している場合
 */
export function createAuth(env: Env): Auth {
  // 環境変数の検証
  validateEnv(env);

  // キャッシュ済みのインスタンスがあれば再利用
  if (cachedAuth) {
    return cachedAuth;
  }

  // Hyperdrive経由でPostgreSQLに接続
  // Hyperdriveが接続プーリングを管理するため、明示的なクリーンアップは不要
  const client = postgres(env.HYPERDRIVE.connectionString, {
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
  });

  // モジュールレベルでキャッシュ
  cachedAuth = auth;

  return auth;
}
