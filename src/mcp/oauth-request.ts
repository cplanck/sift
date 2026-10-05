import "server-only";
import { eq } from "drizzle-orm";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { database } from "@/db";
import type { Database } from "@/db/connection";
import { oauthClient } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { requireConfig } from "@/lib/env";
import { MCP_SCOPES } from "@/services/mcp-connections";

export type VerifiedOAuthRequest = { clientId: string; clientName: string; scopes: string[]; redirectUri: string; oauthQuery: string; authorizePath: string };
export async function verifyOAuthRequest(db: Database, config: { secret: string; baseURL: string }, oauthQuery: string): Promise<VerifiedOAuthRequest> {
  const invalid = () => new DomainError("INVALID_INPUT", "This connection request has expired or is invalid. Start again from your AI app.");
  if (oauthQuery.length > 16_384 || !await verifyOAuthQueryParams(oauthQuery, config.secret)) throw invalid();
  const query = new URLSearchParams(oauthQuery);
  for (const key of ["client_id", "redirect_uri", "scope", "code_challenge", "code_challenge_method", "response_type"]) {
    if (query.getAll(key).length !== 1) throw invalid();
  }
  const clientId = query.get("client_id")!, redirectUri = query.get("redirect_uri")!;
  const scopes = [...new Set(query.get("scope")!.split(" ").filter(Boolean))];
  if (!scopes.length || scopes.some((scope) => !MCP_SCOPES.includes(scope as typeof MCP_SCOPES[number]))
    || query.get("response_type") !== "code" || query.get("code_challenge_method") !== "S256") throw invalid();
  const resources = query.getAll("resource");
  if (resources.length !== 1 || resources[0] !== `${config.baseURL.replace(/\/$/, "")}/api/mcp`) throw invalid();
  const [client] = await db.select().from(oauthClient).where(eq(oauthClient.clientId, clientId));
  if (!client || client.disabled) throw invalid();
  // Provider has already validated native loopback ports. Its signed URI is authoritative;
  // repeat the registration match here while allowing only that standards-defined port exception.
  const registered = client.redirectUris.some((uri) => {
    if (uri === redirectUri) return true;
    try {
      const allowed = new URL(uri), target = new URL(redirectUri);
      return allowed.protocol === "http:" && target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(allowed.hostname)
        && target.hostname === allowed.hostname && target.pathname === allowed.pathname && target.search === allowed.search && !target.hash && !target.username && !target.password;
    } catch { return false; }
  });
  if (!registered) throw invalid();
  const authorizeQuery = new URLSearchParams(query);
  for (const key of ["sig", "exp", "ba_iat", "ba_param", "ba_pl"]) authorizeQuery.delete(key);
  return { clientId, clientName: client.name?.slice(0, 200) || "Connected app", scopes, redirectUri, oauthQuery,
    authorizePath: `/api/auth/oauth2/authorize?${authorizeQuery}` };
}
export async function getVerifiedOAuthRequest(oauthQuery: string) {
  const config = requireConfig(["BETTER_AUTH_SECRET"]);
  return verifyOAuthRequest(database(), { secret: config.BETTER_AUTH_SECRET, baseURL: config.BETTER_AUTH_URL }, oauthQuery);
}
