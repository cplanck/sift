import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { Database } from "@/db/connection";
import { authSchema } from "@/db/schema";
import { ensurePersonalWorkspace } from "@/services/workspaces";

export function createAuth(db: Database, config: { secret: string; baseURL: string }) {
  return betterAuth({
    appName: "Sift", secret: config.secret, baseURL: config.baseURL,
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    advanced: { database: { generateId: () => randomUUID() } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 100,
      customRules: { "/sign-in/email": { window: 60, max: 10 }, "/sign-up/email": { window: 60, max: 10 } },
    },
    session: { cookieCache: { enabled: false } },
    user: { additionalFields: { activeWorkspaceId: { type: "string", required: false, input: false } } },
    databaseHooks: { user: { create: { after: async (user) => { await ensurePersonalWorkspace(db, user.id); } } } },
    logger: { disabled: true },
  });
}
