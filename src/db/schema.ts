import { sql } from "drizzle-orm";
import { bigint, boolean, doublePrecision, foreignKey, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { RecipeContent, RecipeSource } from "@/domain/recipe";
import type { StockPhoto } from "@/domain/stock-photo";
import type { CookingProgress } from "@/domain/cooking";
import type { ArtifactContent } from "@/domain/artifact";
import type { UIMessage } from "ai";
import type { ClientPageContext } from "@/domain/assistant";

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

// Better Auth 1.7.7 OAuth/JWT persistence. Keep every provider field available to its adapter.
export const jwks = pgTable("jwks", {
  id: uuid("id").defaultRandom().primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  alg: text("alg"),
  crv: text("crv"),
});

export const oauthClient = pgTable("oauth_client", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  clientDiscoveryId: text("client_discovery_id"),
  disabled: boolean("disabled").default(false),
  skipConsent: boolean("skip_consent"),
  enableEndSession: boolean("enable_end_session"),
  subjectType: text("subject_type"),
  scopes: text("scopes").array(),
  clientCredentialsScopes: text("client_credentials_scopes").array().default([]),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  name: text("name"),
  uri: text("uri"),
  icon: text("icon"),
  contacts: text("contacts").array(),
  tos: text("tos"),
  policy: text("policy"),
  softwareId: text("software_id"),
  softwareVersion: text("software_version"),
  softwareStatement: text("software_statement"),
  redirectUris: text("redirect_uris").array().notNull(),
  postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
  backchannelLogoutUri: text("backchannel_logout_uri"),
  backchannelLogoutSessionRequired: boolean("backchannel_logout_session_required"),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
  applicationType: text("application_type"),
  jwks: text("jwks"),
  jwksUri: text("jwks_uri"),
  grantTypes: text("grant_types").array(),
  responseTypes: text("response_types").array(),
  requirePKCE: boolean("require_p_k_c_e"),
  dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
  referenceId: text("reference_id"),
  metadata: jsonb("metadata"),
}, (table) => [index("oauth_client_user_id_idx").on(table.userId)]);

export const oauthResource = pgTable("oauth_resource", {
  id: uuid("id").defaultRandom().primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes").array(),
  customClaims: jsonb("custom_claims"),
  dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required").default(false),
  disabled: boolean("disabled").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  policyVersion: integer("policy_version").default(1),
  metadata: jsonb("metadata"),
});

export const oauthClientResource = pgTable("oauth_client_resource", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: text("client_id").notNull().references(() => oauthClient.clientId, { onDelete: "cascade" }),
  resourceId: text("resource_id").notNull().references(() => oauthResource.identifier, { onDelete: "cascade" }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }),
}, (table) => [index("oauth_client_resource_client_id_idx").on(table.clientId), index("oauth_client_resource_resource_id_idx").on(table.resourceId), uniqueIndex("oauth_client_resource_client_id_resource_id_idx").on(table.clientId, table.resourceId)]);

export const oauthRefreshToken = pgTable("oauth_refresh_token", {
  id: uuid("id").defaultRandom().primaryKey(),
  token: text("token").notNull().unique(),
  clientId: text("client_id").notNull().references(() => oauthClient.clientId, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("reference_id"),
  authorizationCodeId: text("authorization_code_id"),
  resources: text("resources").array(),
  requestedUserInfoClaims: text("requested_user_info_claims").array(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  revoked: timestamp("revoked", { withTimezone: true }),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  rotationReplayResponse: text("rotation_replay_response"),
  rotationReplayExpiresAt: timestamp("rotation_replay_expires_at", { withTimezone: true }),
  authTime: timestamp("auth_time", { withTimezone: true }),
  confirmation: jsonb("confirmation"),
  scopes: text("scopes").array().notNull(),
}, (table) => [index("oauth_refresh_token_client_id_idx").on(table.clientId), index("oauth_refresh_token_session_id_idx").on(table.sessionId), index("oauth_refresh_token_user_id_idx").on(table.userId), index("oauth_refresh_token_authorization_code_id_idx").on(table.authorizationCodeId)]);

export const oauthAccessToken = pgTable("oauth_access_token", {
  id: uuid("id").defaultRandom().primaryKey(),
  token: text("token").notNull().unique(),
  clientId: text("client_id").notNull().references(() => oauthClient.clientId, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("reference_id"),
  authorizationCodeId: text("authorization_code_id"),
  resources: text("resources").array(),
  requestedUserInfoClaims: text("requested_user_info_claims").array(),
  refreshId: uuid("refresh_id").references(() => oauthRefreshToken.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  revoked: timestamp("revoked", { withTimezone: true }),
  confirmation: jsonb("confirmation"),
  scopes: text("scopes").array().notNull(),
}, (table) => [index("oauth_access_token_client_id_idx").on(table.clientId), index("oauth_access_token_session_id_idx").on(table.sessionId), index("oauth_access_token_user_id_idx").on(table.userId), index("oauth_access_token_authorization_code_id_idx").on(table.authorizationCodeId), index("oauth_access_token_refresh_id_idx").on(table.refreshId)]);

export const oauthConsent = pgTable("oauth_consent", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: text("client_id").notNull().references(() => oauthClient.clientId, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("reference_id"),
  resources: text("resources").array(),
  requestedUserInfoClaims: text("requested_user_info_claims").array(),
  scopes: text("scopes").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [index("oauth_consent_client_id_idx").on(table.clientId), index("oauth_consent_user_id_idx").on(table.userId)]);

export const oauthClientAssertion = pgTable("oauth_client_assertion", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Bind each provider token family to the consent that originally authorized it.
export const mcpAuthorizations = pgTable("mcp_authorizations", {
  codeHash: text("code_hash").primaryKey(),
  consentId: uuid("consent_id").notNull().references(() => oauthConsent.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

export const mcpRevocations = pgTable("mcp_revocations", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => oauthClient.clientId, { onDelete: "cascade" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.clientId] })]);

export const authSchema = { user: users, session: sessions, account: accounts, verification: verifications, rateLimit: rateLimits, jwks, oauthClient, oauthResource, oauthClientResource, oauthRefreshToken, oauthAccessToken, oauthConsent, oauthClientAssertion };

export const recipeStatus = pgEnum("recipe_status", ["draft", "active", "archived"]);
export const recipes = pgTable("recipes", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  currentVersionId: uuid("current_version_id").references((): AnyPgColumn => recipeVersions.id),
  status: recipeStatus("status").default("draft").notNull(),
  source: jsonb("source").$type<RecipeSource>().notNull(),
  coverPhotoId: uuid("cover_photo_id"),
  coverSelection: text("cover_selection", { enum: ["auto", "selected", "none"] }).default("auto").notNull(),
  coverRevision: integer("cover_revision").default(0).notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("recipes_workspace_id_idx").on(table.workspaceId, table.id), index("recipes_workspace_status_idx").on(table.workspaceId, table.status, table.updatedAt)]);

export const recipeStockPhotos = pgTable("recipe_stock_photos", {
  recipeId: uuid("recipe_id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  photo: jsonb("photo").$type<StockPhoto>().notNull(),
  createdAt: createdAt(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.recipeId], foreignColumns: [recipes.workspaceId, recipes.id], name: "recipe_stock_photos_workspace_recipe_fk" }).onDelete("cascade"),
]);

export const recipeVersions = pgTable("recipe_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  recipeId: uuid("recipe_id").notNull(), number: integer("number").notNull(),
  content: jsonb("content").$type<RecipeContent>().notNull(),
  changeSummary: text("change_summary").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.recipeId], foreignColumns: [recipes.workspaceId, recipes.id], name: "recipe_versions_workspace_recipe_fk" }).onDelete("cascade"),
  uniqueIndex("recipe_versions_number_idx").on(table.recipeId, table.number),
  uniqueIndex("recipe_versions_workspace_recipe_id_idx").on(table.workspaceId, table.recipeId, table.id),
  index("recipe_versions_workspace_recipe_idx").on(table.workspaceId, table.recipeId),
]);

export const recipeNotes = pgTable("recipe_notes", {
  id: uuid("id").defaultRandom().primaryKey(), workspaceId: uuid("workspace_id").notNull(), recipeId: uuid("recipe_id").notNull(),
  body: text("body").notNull(), createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.recipeId], foreignColumns: [recipes.workspaceId, recipes.id], name: "recipe_notes_workspace_recipe_fk" }).onDelete("cascade"),
  index("recipe_notes_workspace_recipe_idx").on(table.workspaceId, table.recipeId),
]);

export const recipeFavorites = pgTable("recipe_favorites", {
  workspaceId: uuid("workspace_id").notNull(), recipeId: uuid("recipe_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.recipeId, table.userId] }),
  foreignKey({ columns: [table.workspaceId, table.recipeId], foreignColumns: [recipes.workspaceId, recipes.id], name: "recipe_favorites_workspace_recipe_fk" }).onDelete("cascade"),
  index("recipe_favorites_workspace_user_idx").on(table.workspaceId, table.userId),
]);

// A personal, short-lived shortlist of recipes to shop and cook for soon.
export const recipePlans = pgTable("recipe_plans", {
  workspaceId: uuid("workspace_id").notNull(), recipeId: uuid("recipe_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.recipeId, table.userId] }),
  foreignKey({ columns: [table.workspaceId, table.recipeId], foreignColumns: [recipes.workspaceId, recipes.id], name: "recipe_plans_workspace_recipe_fk" }).onDelete("cascade"),
  index("recipe_plans_workspace_user_idx").on(table.workspaceId, table.userId),
]);

export const cookingSessions = pgTable("cooking_sessions", {
  id: uuid("id").defaultRandom().primaryKey(), workspaceId: uuid("workspace_id").notNull(), recipeId: uuid("recipe_id").notNull(),
  recipeVersionId: uuid("recipe_version_id").notNull(),
  startedByUserId: uuid("started_by_user_id").references(() => users.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(), finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status", { enum: ["active", "completed", "abandoned"] }).default("active").notNull(),
  servings: doublePrecision("servings").notNull(), revision: integer("revision").default(1).notNull(),
  progress: jsonb("progress").$type<CookingProgress>().notNull().default({ checkedIngredients: [], checkedSteps: [], currentStep: 0 }),
  rating: integer("rating"), summary: text("summary"),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.recipeId], foreignColumns: [recipes.workspaceId, recipes.id], name: "cooking_sessions_workspace_recipe_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.workspaceId, table.recipeId, table.recipeVersionId], foreignColumns: [recipeVersions.workspaceId, recipeVersions.recipeId, recipeVersions.id], name: "cooking_sessions_exact_version_fk" }).onDelete("cascade"),
  uniqueIndex("cooking_sessions_workspace_id_idx").on(table.workspaceId, table.id),
  uniqueIndex("cooking_sessions_active_idx").on(table.workspaceId, table.recipeId, table.startedByUserId).where(sql`${table.status} = 'active'`),
  index("cooking_sessions_workspace_recipe_idx").on(table.workspaceId, table.recipeId, table.startedAt),
]);

export const cookingTimers = pgTable("cooking_timers", {
  id: uuid("id").defaultRandom().primaryKey(), workspaceId: uuid("workspace_id").notNull(), sessionId: uuid("session_id").notNull(),
  label: text("label").notNull(), stepKey: text("step_key"), durationSeconds: integer("duration_seconds").notNull(),
  remainingMs: bigint("remaining_ms", { mode: "number" }).notNull(), dueAt: timestamp("due_at", { withTimezone: true }),
  status: text("status", { enum: ["running", "paused", "dismissed"] }).default("running").notNull(),
  revision: integer("revision").default(1).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.sessionId], foreignColumns: [cookingSessions.workspaceId, cookingSessions.id], name: "cooking_timers_workspace_session_fk" }).onDelete("cascade"),
  index("cooking_timers_session_idx").on(table.workspaceId, table.sessionId),
]);

export const cookingSessionNotes = pgTable("cooking_session_notes", {
  id: uuid("id").defaultRandom().primaryKey(), workspaceId: uuid("workspace_id").notNull(), sessionId: uuid("session_id").notNull(),
  body: text("body").notNull(), createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }), createdAt: createdAt(),
  organizedBody: text("organized_body"), wrapUp: boolean("wrap_up").notNull().default(false),
  cleanupStatus: text("cleanup_status", { enum: ["none", "queued", "processing", "ready", "failed"] }).notNull().default("none"),
  cleanupDispatchedAt: timestamp("cleanup_dispatched_at", { withTimezone: true }),
  cleanupStartedAt: timestamp("cleanup_started_at", { withTimezone: true }),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.sessionId], foreignColumns: [cookingSessions.workspaceId, cookingSessions.id], name: "cooking_notes_workspace_session_fk" }).onDelete("cascade"),
  index("cooking_notes_workspace_session_idx").on(table.workspaceId, table.sessionId),
  uniqueIndex("cooking_notes_wrap_up_idx").on(table.sessionId).where(sql`${table.wrapUp} = true`),
]);

export const photos = pgTable("photos", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  recipeId: uuid("recipe_id"),
  sessionId: uuid("session_id"),
  purpose: text("purpose", { enum: ["recipe", "import", "cooking", "chat"] }).notNull(),
  status: text("status", { enum: ["pending", "ready"] }).default("pending").notNull(),
  objectKey: text("object_key").notNull().unique(),
  contentType: text("content_type").notNull(), byteSize: integer("byte_size").notNull(),
  width: integer("width"), height: integer("height"),
  origin: text("origin", { enum: ["user", "imported", "generated"] }).default("user").notNull(),
  originalObjectKey: text("original_object_key"),
  derivatives: jsonb("derivatives").$type<{ objectKey: string; width: number; height: number }[]>(),
  provenance: jsonb("provenance").$type<{ requestId: string; model: string; promptVersion: string; contentHash: string; checksum: string; sourcePhotoId?: string }>(),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.recipeId], foreignColumns: [recipes.workspaceId, recipes.id], name: "photos_workspace_recipe_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.workspaceId, table.sessionId], foreignColumns: [cookingSessions.workspaceId, cookingSessions.id], name: "photos_workspace_session_fk" }).onDelete("cascade"),
  index("photos_workspace_recipe_idx").on(table.workspaceId, table.recipeId),
  index("photos_workspace_session_idx").on(table.workspaceId, table.sessionId),
]);

export const recipeImports = pgTable("recipe_imports", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["paste", "url", "image", "mcp"] }).notNull(),
  rawText: text("raw_text"), sourceUrl: text("source_url"),
  photoId: uuid("photo_id").references(() => photos.id, { onDelete: "set null" }),
  recipeId: uuid("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
  status: text("status", { enum: ["queued", "processing", "review", "saved", "failed"] }).default("queued").notNull(),
  errorMessage: text("error_message"),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [index("recipe_imports_workspace_status_idx").on(table.workspaceId, table.status)]);

export const recipeShares = pgTable("recipe_shares", {
  id: uuid("id").defaultRandom().primaryKey(), workspaceId: uuid("workspace_id").notNull(), recipeId: uuid("recipe_id").notNull(),
  versionId: uuid("version_id").notNull().references(() => recipeVersions.id, { onDelete: "cascade" }),
  coverPhotoId: uuid("cover_photo_id").references(() => photos.id, { onDelete: "set null" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }), createdAt: createdAt(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.recipeId], foreignColumns: [recipes.workspaceId, recipes.id], name: "recipe_shares_workspace_recipe_fk" }).onDelete("cascade"),
  index("recipe_shares_workspace_recipe_idx").on(table.workspaceId, table.recipeId),
]);

export const usageLimits = pgTable("usage_limits", {
  key: text("key").primaryKey(), userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  count: integer("count").default(1).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [index("usage_limits_expires_idx").on(table.expiresAt)]);

export const artifacts = pgTable("artifacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["grocery", "meal-plan"] }).notNull(), title: text("title").notNull(),
  revision: integer("revision").default(1).notNull(), content: jsonb("content").$type<ArtifactContent>().notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [index("artifacts_workspace_updated_idx").on(table.workspaceId, table.updatedAt)]);

export const gatewayCredentials = pgTable("gateway_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("vercel-ai-gateway"),
  encryptedSecret: text("encrypted_secret").notNull(), hint: text("hint").notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("gateway_credentials_user_provider_idx").on(table.userId, table.provider)]);

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(), messages: jsonb("messages").$type<UIMessage[]>().notNull().default([]),
  modelId: text("model_id"),
  activeRunId: uuid("active_run_id"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  lastError: text("last_error"), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [index("conversations_workspace_user_idx").on(table.workspaceId, table.createdByUserId, table.updatedAt)]);

export const conversationTurns = pgTable("conversation_turns", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  requestId: uuid("request_id").notNull(),
  status: text("status", { enum: ["running", "completed", "failed", "aborted"] }).notNull(),
  createdAt: createdAt(), finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [uniqueIndex("conversation_turns_request_idx").on(table.conversationId, table.requestId)]);

export const conversationToolCalls = pgTable("conversation_tool_calls", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => conversationTurns.id, { onDelete: "cascade" }),
  toolCallId: text("tool_call_id").notNull(), toolName: text("tool_name").notNull(),
  result: jsonb("result").$type<unknown>().notNull(), createdAt: createdAt(),
}, (table) => [uniqueIndex("conversation_tool_calls_call_idx").on(table.conversationId, table.toolCallId)]);

export const aiUsage = pgTable("ai_usage", {
  id: uuid("id").defaultRandom().primaryKey(), idempotencyKey: text("idempotency_key").notNull().unique(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  runId: uuid("run_id").references(() => conversationTurns.id, { onDelete: "set null" }),
  importId: uuid("import_id").references(() => recipeImports.id, { onDelete: "set null" }),
  model: text("model").notNull(), credentialSource: text("credential_source", { enum: ["user", "app"] }).notNull(),
  inputTokens: integer("input_tokens"), outputTokens: integer("output_tokens"), totalTokens: integer("total_tokens"),
  costUsd: numeric("cost_usd", { precision: 20, scale: 10 }), generationId: text("generation_id"),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [index("ai_usage_workspace_user_idx").on(table.workspaceId, table.userId, table.createdAt), index("ai_usage_conversation_idx").on(table.conversationId)]);

export const voiceSessions = pgTable("voice_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  authSessionId: uuid("auth_session_id").references(() => sessions.id, { onDelete: "set null" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  providerConversationId: text("provider_conversation_id").unique(), agentId: text("agent_id"),
  status: text("status", { enum: ["preparing", "ready", "ended", "failed"] }).notNull().default("preparing"),
  context: jsonb("context").$type<ClientPageContext>().notNull(), revision: integer("revision").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
  activeRunId: uuid("active_run_id").references(() => conversationTurns.id, { onDelete: "set null" }),
  lastUserCount: integer("last_user_count").notNull().default(0), lastProviderTurn: integer("last_provider_turn").notNull().default(-1), lastFingerprint: text("last_fingerprint"),
  durationSeconds: integer("duration_seconds"), costUsd: numeric("cost_usd", { precision: 20, scale: 10 }),
  credits: bigint("credits", { mode: "number" }), usageStatus: text("usage_status"),
  createdAt: createdAt(), endedAt: timestamp("ended_at", { withTimezone: true }), updatedAt: updatedAt(),
}, (table) => [index("voice_sessions_user_conversation_idx").on(table.workspaceId, table.userId, table.conversationId), index("voice_sessions_auth_session_idx").on(table.authSessionId)]);

export const voiceTurns = pgTable("voice_turns", {
  id: uuid("id").defaultRandom().primaryKey(),
  voiceSessionId: uuid("voice_session_id").notNull().references(() => voiceSessions.id, { onDelete: "cascade" }),
  fingerprint: text("fingerprint").notNull(), providerTurn: integer("provider_turn").notNull(), userCount: integer("user_count").notNull(),
  runId: uuid("run_id").references(() => conversationTurns.id, { onDelete: "set null" }),
  status: text("status", { enum: ["running", "completed", "failed", "aborted"] }).notNull(),
  responseText: text("response_text"), requiresApproval: boolean("requires_approval").notNull().default(false),
  createdAt: createdAt(), finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [uniqueIndex("voice_turns_fingerprint_idx").on(table.voiceSessionId, table.fingerprint), index("voice_turns_run_idx").on(table.runId)]);

// Each request is also a durable outbox entry. Provider output is retained until
// publication so storage retries never purchase a second generation.
export const coverRequests = pgTable("cover_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  recipeId: uuid("recipe_id").notNull(),
  requestedByUserId: uuid("requested_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  // Retain lineage if the source is deleted; deletion cancels unfinished edits.
  sourcePhotoId: uuid("source_photo_id"),
  snapshot: jsonb("snapshot").$type<RecipeContent>().notNull(),
  contentHash: text("content_hash").notNull(),
  expectedCoverRevision: integer("expected_cover_revision").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  status: text("status", { enum: ["queued", "running", "ready", "failed", "cancelled"] }).default("queued").notNull(),
  reservedUsd: numeric("reserved_usd", { precision: 20, scale: 10 }).notNull(),
  candidatePhotoId: uuid("candidate_photo_id").references(() => photos.id, { onDelete: "set null" }),
  errorMessage: text("error_message"),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.recipeId], foreignColumns: [recipes.workspaceId, recipes.id], name: "cover_requests_workspace_recipe_fk" }).onDelete("cascade"),
  uniqueIndex("cover_requests_idempotency_idx").on(table.workspaceId, table.idempotencyKey),
  uniqueIndex("cover_requests_active_idx").on(table.recipeId).where(sql`${table.status} in ('queued', 'running')`),
]);
export const coverAttempts = pgTable("cover_attempts", {
  requestId: uuid("request_id").primaryKey().references(() => coverRequests.id, { onDelete: "cascade" }),
  outputBase64: text("output_base64"),
  mediaType: text("media_type"),
  costUsd: numeric("cost_usd", { precision: 20, scale: 10 }),
  generationId: text("generation_id"),
  latencyMs: integer("latency_ms"),
  credentialSource: text("credential_source", { enum: ["user", "app"] }).notNull(),
  createdAt: createdAt(),
});

// Retained independently of recipes so discarding a draft cannot reset spending.
export const coverDailyBudgets = pgTable("cover_daily_budgets", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  day: text("day").notNull(),
  committedUsd: numeric("committed_usd", { precision: 20, scale: 10 }).notNull(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.day] })]);
