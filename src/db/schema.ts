import { bigint, boolean, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  activeWorkspaceId: uuid("active_workspace_id").references((): AnyPgColumn => workspaces.id, { onDelete: "set null" }),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"), userAgent: text("user_agent"),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [index("sessions_user_idx").on(table.userId)]);

export const accounts = pgTable("accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(), providerId: text("provider_id").notNull(),
  accessToken: text("access_token"), refreshToken: text("refresh_token"), idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"), password: text("password"),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [index("accounts_user_idx").on(table.userId), uniqueIndex("accounts_provider_account_idx").on(table.providerId, table.accountId)]);

export const verifications = pgTable("verifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  identifier: text("identifier").notNull(), value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [index("verifications_identifier_idx").on(table.identifier)]);

export const rateLimits = pgTable("rate_limits", {
  id: uuid("id").defaultRandom().primaryKey(), key: text("key").notNull().unique(),
  count: integer("count").notNull(), lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(), name: text("name").notNull(),
  personalForUserId: uuid("personal_for_user_id").unique().references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const workspaceMembers = pgTable("workspace_members", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["owner", "member"] }).default("member").notNull(),
  createdAt: createdAt(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.userId] }), index("workspace_members_user_idx").on(table.userId)]);

export const authSchema = { user: users, session: sessions, account: accounts, verification: verifications, rateLimit: rateLimits };
