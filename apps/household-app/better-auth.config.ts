import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const { DATABASE_URL, BETTER_AUTH_URL, BETTER_AUTH_SECRET } = process.env;
if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not defined in environment variables.");
}

const client = postgres(DATABASE_URL);

const db = drizzle(client);

export const auth: ReturnType<typeof betterAuth> = betterAuth({
    database: drizzleAdapter(db, { provider: 'pg' }),
});