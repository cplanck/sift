import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { Database } from "@/db/connection";
import { authSchema } from "@/db/schema";
import { ensurePersonalWorkspace } from "@/services/workspaces";
import { createMcpProvider } from "@/mcp/oauth-provider";

export function createAuth(db: Database, config: { secret: string; baseURL: string }) {
  const provider = createMcpProvider(db, config.baseURL);
  return betterAuth({
    appName: "Sift", secret: config.secret, baseURL: config.baseURL,
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    advanced: { database: { generateId: () => randomUUID() } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 100,
      customRules: { "/sign-in/email": { window: 60, max: 10 }, "/sign-up/email": { window: 60, max: 10 } },
    },
    session: { cookieCache: { enabled: false } },
    plugins: [jwt(), provider.plugin, cimd({ metadataProfile: "mcp-2026-07-28", fetchClientMetadataResource })],
    // Connection removal must also revoke token families and Sift grant bindings.
    disabledPaths: ["/token", "/oauth2/delete-consent", "/oauth2/update-consent"],
    hooks: { before: provider.beforeToken },
    user: { additionalFields: { activeWorkspaceId: { type: "string", required: false, input: false } } },
    databaseHooks: {
      user: { create: { after: async (user) => { await ensurePersonalWorkspace(db, user.id); } } },
      verification: { create: { before: provider.beforeVerificationCreate } },
    },
    logger: { disabled: true },
  });
}
