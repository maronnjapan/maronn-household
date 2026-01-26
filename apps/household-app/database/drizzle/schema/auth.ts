import { relations } from "drizzle-orm";
import { sqliteTable, text, integer, index, customType } from "drizzle-orm/sqlite-core";

/**
 * Better Auth用のカスタム日付型
 * DateオブジェクトをISO 8601形式の文字列に変換してD1に保存
 * D1（SQLite）はDate.toString()形式を正しく処理できないため必要
 */
const dateText = customType<{ data: Date; driverData: string }>({
  dataType() {
    return "text";
  },
  toDriver(value: Date): string {
    return value.toISOString();
  },
  fromDriver(value: string): Date {
    return new Date(value);
  },
});

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
  image: text("image"),
  createdAt: dateText("created_at").notNull(),
  updatedAt: dateText("updated_at").notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: dateText("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: dateText("created_at").notNull(),
    updatedAt: dateText("updated_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: dateText("access_token_expires_at"),
    refreshTokenExpiresAt: dateText("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: dateText("created_at").notNull(),
    updatedAt: dateText("updated_at").notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: dateText("expires_at").notNull(),
    createdAt: dateText("created_at").notNull(),
    updatedAt: dateText("updated_at").notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
