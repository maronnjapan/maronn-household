import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as authSchema from "../database/drizzle/schema/auth";

/**
 * Better Auth設定
 * Auth0を使用したOAuth認証
 * Hyperdrive経由でSupabase PostgreSQLに接続
 */

interface Env {
  HYPERDRIVE: Hyperdrive;
  AUTH0_DOMAIN: string;
  AUTH0_CLIENT_ID: string;
  AUTH0_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}

export function createAuth(env: Env) {
  // Hyperdrive経由でPostgreSQLに接続
  const client = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  const db = drizzle(client, { schema: authSchema });

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.BETTER_AUTH_URL],
    socialProviders: {
      auth0: {
        clientId: env.AUTH0_CLIENT_ID,
        clientSecret: env.AUTH0_CLIENT_SECRET,
        domain: env.AUTH0_DOMAIN,
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
