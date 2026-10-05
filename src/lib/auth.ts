import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { database } from "@/db";
import { DomainError } from "@/domain/errors";
import { ensurePersonalWorkspace } from "@/services/workspaces";
import { createAuth } from "./auth-config";
import { env, requireConfig } from "./env";

let instance: ReturnType<typeof createAuth> | undefined;
export function auth() {
  if (!instance) {
    const config = requireConfig(["BETTER_AUTH_SECRET", "DATABASE_URL"]);
    instance = createAuth(database(), { secret: config.BETTER_AUTH_SECRET, baseURL: config.BETTER_AUTH_URL });
  }
  return instance;
}
export function isAuthConfigured() { const config = env(); return !!config.DATABASE_URL && !!config.BETTER_AUTH_SECRET; }

export async function getViewer(requestHeaders?: Headers) {
  if (!isAuthConfigured()) return null;
  const session = await auth().api.getSession({ headers: requestHeaders ?? await headers() });
  if (!session) return null;
  const workspaceId = await ensurePersonalWorkspace(database(), session.user.id);
  return { userId: session.user.id, workspaceId, name: session.user.name, email: session.user.email, sessionExpiresAt: session.session.expiresAt.toISOString() };
}

export async function requireViewer() {
  if (!isAuthConfigured()) redirect("/setup");
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  return viewer;
}

export async function requestActor(request: Request) {
  const viewer = await getViewer(request.headers);
  if (!viewer) throw new DomainError("UNAUTHENTICATED", "Please sign in.");
  return viewer;
}
