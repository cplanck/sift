import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database, Executor } from "@/db/connection";
import { mcpAuthorizations, mcpRevocations, oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken, sessions } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { assertMembership, type Actor } from "@/services/workspaces";

export const MCP_SCOPES = ["recipes:read", "recipes:write", "offline_access"] as const;
export type McpPrincipal = { actor: Actor; scopes: string[]; clientId: string; clientName: string; consentId: string; sessionId: string };
export type McpConnection = { id: string; clientId: string; name: string; scopes: string[]; createdAt: string; updatedAt: string };

export async function listMcpConnections(db: Database, actor: Actor): Promise<McpConnection[]> {
  await assertMembership(db, actor);
  const rows = await db.select({ consent: oauthConsent, client: oauthClient }).from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(and(eq(oauthConsent.userId, actor.userId), eq(oauthConsent.referenceId, actor.workspaceId)));
  return rows.map(({ consent, client }) => ({ id: consent.id, clientId: consent.clientId,
    name: client.name?.slice(0, 200) || "Connected app", scopes: consent.scopes,
    createdAt: consent.createdAt.toISOString(), updatedAt: consent.updatedAt.toISOString() }));
}

export async function revokeMcpConnection(db: Database, actor: Actor, consentId: string): Promise<void> {
  if (!z.uuid().safeParse(consentId).success) throw new DomainError("NOT_FOUND", "Connection not found.");
  await db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    const [consent] = await tx.select().from(oauthConsent).where(and(eq(oauthConsent.id, consentId),
      eq(oauthConsent.userId, actor.userId), eq(oauthConsent.referenceId, actor.workspaceId))).for("update");
    if (!consent) throw new DomainError("NOT_FOUND", "Connection not found.");
    const revokedAt = new Date();
    await tx.insert(mcpRevocations).values({ userId: actor.userId, clientId: consent.clientId, revokedAt })
      .onConflictDoUpdate({ target: [mcpRevocations.userId, mcpRevocations.clientId], set: { revokedAt } });
    // Delete both token formats and their rotation replay data, then the durable grant binding.
    await tx.delete(oauthAccessToken).where(and(eq(oauthAccessToken.userId, actor.userId), eq(oauthAccessToken.clientId, consent.clientId)));
    await tx.delete(oauthRefreshToken).where(and(eq(oauthRefreshToken.userId, actor.userId), eq(oauthRefreshToken.clientId, consent.clientId)));
    await tx.delete(oauthConsent).where(eq(oauthConsent.id, consent.id));
  });
}

/** Called only after the official verifier has authenticated this token's claims. */
export async function resolveMcpPrincipal(db: Executor, claims: Record<string, unknown>): Promise<McpPrincipal> {
  const invalid = () => new DomainError("UNAUTHENTICATED", "This connection has expired or was revoked. Connect Sift again.");
  if (typeof claims.sub !== "string" || typeof claims.client_id !== "string" || typeof claims.sid !== "string"
    || typeof claims.sift_grant !== "string" || typeof claims.sift_consent !== "string" || typeof claims.sift_workspace !== "string"
    || typeof claims.scope !== "string") throw invalid();
  // Cast-free UUID validation also keeps hostile token claims out of PostgreSQL UUID parameters.
  for (const value of [claims.sub, claims.sid, claims.sift_consent, claims.sift_workspace]) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw invalid();
  }
  const [row] = await db.select({ grant: mcpAuthorizations, consent: oauthConsent, client: oauthClient, session: sessions })
    .from(mcpAuthorizations).innerJoin(oauthConsent, eq(oauthConsent.id, mcpAuthorizations.consentId))
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .innerJoin(sessions, eq(sessions.id, mcpAuthorizations.sessionId))
    .where(eq(mcpAuthorizations.codeHash, claims.sift_grant));
  if (!row || row.consent.id !== claims.sift_consent || row.consent.userId !== claims.sub
    || row.consent.clientId !== claims.client_id || row.consent.referenceId !== claims.sift_workspace
    || row.session.id !== claims.sid || row.session.userId !== claims.sub || row.session.expiresAt <= new Date()
    || row.client.disabled) throw invalid();
  const scopes = [...new Set(claims.scope.split(" ").filter(Boolean))];
  if (!scopes.length || scopes.some((scope) => !row.consent.scopes.includes(scope) || !MCP_SCOPES.includes(scope as typeof MCP_SCOPES[number]))) throw invalid();
  const actor = { userId: claims.sub, workspaceId: claims.sift_workspace };
  try { await assertMembership(db, actor); } catch { throw invalid(); }
  return { actor, scopes, clientId: row.client.clientId, clientName: row.client.name?.slice(0, 200) || "Connected app",
    consentId: row.consent.id, sessionId: row.session.id };
}
