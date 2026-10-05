import "server-only";
import { requireMcpAuth } from "@better-auth/mcp";
import { database } from "@/db";
import type { Database } from "@/db/connection";
import { auth } from "@/lib/auth";
import type { createAuth } from "@/lib/auth-config";
import { env } from "@/lib/env";
import { DomainError } from "@/domain/errors";
import { resolveMcpPrincipal, type McpPrincipal } from "@/services/mcp-connections";
export type { McpPrincipal } from "@/services/mcp-connections";

export async function authorizeMcpRequest(request: Request, handler: (request: Request, principal: McpPrincipal) => Promise<Response>,
  config: { auth: ReturnType<typeof createAuth>; db: Database; baseURL: string }) {
  const origin = new URL(config.baseURL).origin;
  // Remote MCP clients normally omit Origin. Reject unrelated browser origins and DNS rebinding.
  const requestOrigin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (new URL(request.url).origin !== origin || (requestOrigin && requestOrigin !== origin) || (host && host !== new URL(config.baseURL).host)) {
    return Response.json({ error: "Forbidden origin." }, { status: 403 });
  }
  const resource = `${config.baseURL.replace(/\/$/, "")}/api/mcp`;
  return requireMcpAuth(config.auth, async (verifiedRequest, claims) => {
    let principal: McpPrincipal;
    try { principal = await resolveMcpPrincipal(config.db, claims); }
    catch (error) {
      if (!(error instanceof DomainError)) throw error;
      return Response.json({ error: "invalid_token", error_description: "This connection has expired or was revoked. Connect Sift again." }, {
        status: 401, headers: { "Cache-Control": "no-store", "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"` },
      });
    }
    return handler(verifiedRequest, principal);
  }, { resource, challengeScopes: ["recipes:read", "recipes:write"] })(request);
}
export async function withMcpAuth(request: Request, handler: (request: Request, principal: McpPrincipal) => Promise<Response>) {
  return authorizeMcpRequest(request, handler, { auth: auth(), db: database(), baseURL: env().BETTER_AUTH_URL });
}
