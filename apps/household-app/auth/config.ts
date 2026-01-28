import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as authSchema from "../database/drizzle/schema/auth";
import { sendEmail, isEmailConfigured } from "../lib/email";
import { buildPasswordResetEmailTemplate } from "../lib/email/password-reset-template";

/**
 * Better Authインスタンスの型
 * createAuth関数の戻り値型として使用
 */
export type Auth = ReturnType<typeof betterAuth>;

/**
 * Better Auth設定
 * メール/パスワード認証
 * Cloudflare D1を使用（SQLite）
 */

interface Env {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  // SendGrid設定（パスワードリセットメール送信用）
  SENDGRID_API_KEY?: string;
  EMAIL_FROM?: string;
  // AWS SES設定（将来の切り替え用に残す）
  // AWS_SES_REGION?: string;
  // AWS_ACCESS_KEY_ID?: string;
  // AWS_SECRET_ACCESS_KEY?: string;
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
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        // SendGrid環境変数が設定されていない場合はログに出力して終了
        if (!isEmailConfigured({ SENDGRID_API_KEY: env.SENDGRID_API_KEY }) || !env.EMAIL_FROM) {
          console.warn("SendGrid environment variables not configured. Password reset email not sent.");
          console.log(`Password reset URL for ${user.email}: ${url}`);
          return;
        }

        const template = buildPasswordResetEmailTemplate({ url });

        await sendEmail(
          { SENDGRID_API_KEY: env.SENDGRID_API_KEY! },
          {
            to: user.email,
            from: env.EMAIL_FROM,
            subject: "【家計簿アプリ】パスワードリセットのご案内",
            bodyText: template.text,
            bodyHtml: template.html,
          }
        );
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
