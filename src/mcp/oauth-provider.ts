import { and, eq } from "drizzle-orm";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { getOAuthProviderApi, type OAuthClaimExtensionInput, type OAuthOptions } from "@better-auth/oauth-provider";
import { mcp, type McpOptions } from "@better-auth/mcp";
import type { Database } from "@/db/connection";
import { mcpAuthorizations, mcpRevocations, oauthConsent, oauthRefreshToken, sessions, verifications } from "@/db/schema";
import { ensurePersonalWorkspace } from "@/services/workspaces";
import { MCP_SCOPES, resolveMcpPrincipal } from "@/services/mcp-connections";
import { z } from "zod";

const storedCodeSchema = z.object({ type: z.literal("authorization_code"), userId: z.uuid(), sessionId: z.uuid(),
  referenceId: z.uuid(), query: z.object({ client_id: z.string() }), siftConsentId: z.uuid().optional() });
const invalidGrant = () => new APIError("BAD_REQUEST", { error: "invalid_grant", error_description: "This authorization has expired or was revoked. Connect Sift again." });

export function createMcpProvider(db: Database, baseURL: string) {
  const resource = `${baseURL.replace(/\/$/, "")}/api/mcp`;
  const options: McpOptions = {
    resource, loginPage: "/sign-in", consentPage: "/consent", scopes: [...MCP_SCOPES],
    grantTypes: ["authorization_code", "refresh_token"], accessTokenExpiresIn: 300,
    allowDynamicClientRegistration: true, allowUnauthenticatedClientRegistration: true,
    clientRegistrationDefaultScopes: ["recipes:read", "offline_access"], clientRegistrationAllowedScopes: ["recipes:write"],
    clientRegistrationRequirePKCE: true, enforcePerClientResources: true,
    postLogin: { page: "/consent", shouldRedirect: async () => false,
      consentReferenceId: async ({ user }) => ensurePersonalWorkspace(db, user.id) },
    extensions: [{ claims: { accessToken: async (input) => {
      const codeHash = await tokenFamily(input);
      if (!codeHash || !input.user?.id || !input.sessionId) throw invalidGrant();
      const [binding] = await db.select().from(mcpAuthorizations).where(eq(mcpAuthorizations.codeHash, codeHash));
      if (!binding) throw invalidGrant();
      const claims = { sub: input.user.id, client_id: input.client.clientId, sid: input.sessionId,
        sift_grant: codeHash, sift_consent: binding.consentId, sift_workspace: input.referenceId, scope: input.scopes.join(" ") };
      try { await resolveMcpPrincipal(db, claims); } catch { throw invalidGrant(); }
      return { sift_grant: codeHash, sift_consent: binding.consentId, sift_workspace: input.referenceId };
    } } }],
  };
  async function tokenFamily({ ctx, opts }: Pick<OAuthClaimExtensionInput, "ctx" | "opts">) {
    const api = getOAuthProviderApi(ctx, opts);
    if (ctx.body?.grant_type === "authorization_code" && typeof ctx.body.code === "string") return api.hashToken(ctx.body.code, "authorization_code");
    if (ctx.body?.grant_type === "refresh_token" && typeof ctx.body.refresh_token === "string") {
      const tokenHash = await api.hashToken(ctx.body.refresh_token, "refresh_token");
      const [token] = await db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.token, tokenHash));
      return token?.authorizationCodeId;
    }
  }
  const beforeToken = createAuthMiddleware(async (ctx) => {
    if (ctx.path !== "/oauth2/token") return;
    const api = getOAuthProviderApi(ctx, options as OAuthOptions<string[]>);
    if (ctx.body?.grant_type === "authorization_code" && typeof ctx.body.code === "string") {
      const codeHash = await api.hashToken(ctx.body.code, "authorization_code");
      const [verification] = await db.select().from(verifications).where(eq(verifications.identifier, codeHash));
      // Let the provider reject unknown/replayed codes, and invalidate the JWT
      // family too: its built-in replay cleanup can only revoke stored tokens.
      if (!verification) {
        await db.delete(mcpAuthorizations).where(eq(mcpAuthorizations.codeHash, codeHash));
        return;
      }
      let parsed: z.infer<typeof storedCodeSchema>;
      try { parsed = storedCodeSchema.parse(JSON.parse(verification.value)); } catch { throw invalidGrant(); }
      await db.transaction(async (tx) => {
        const [consent] = await tx.select().from(oauthConsent).where(and(eq(oauthConsent.userId, parsed.userId),
          eq(oauthConsent.clientId, parsed.query.client_id), eq(oauthConsent.referenceId, parsed.referenceId))).for("update");
        const [revoked] = await tx.select().from(mcpRevocations).where(and(eq(mcpRevocations.userId, parsed.userId), eq(mcpRevocations.clientId, parsed.query.client_id)));
        const [session] = await tx.select().from(sessions).where(eq(sessions.id, parsed.sessionId));
        if (!consent || consent.id !== parsed.siftConsentId || !session || session.userId !== parsed.userId || session.expiresAt <= new Date()
          || (revoked && verification.createdAt <= revoked.revokedAt)) throw invalidGrant();
        await tx.insert(mcpAuthorizations).values({ codeHash, consentId: consent.id, sessionId: session.id }).onConflictDoNothing();
      });
    } else if (ctx.body?.grant_type === "refresh_token") {
      const codeHash = await tokenFamily({ ctx, opts: options });
      if (!codeHash) throw invalidGrant();
      const [binding] = await db.select({ grant: mcpAuthorizations, consent: oauthConsent, session: sessions }).from(mcpAuthorizations)
        .innerJoin(oauthConsent, eq(oauthConsent.id, mcpAuthorizations.consentId))
        .innerJoin(sessions, eq(sessions.id, mcpAuthorizations.sessionId)).where(eq(mcpAuthorizations.codeHash, codeHash));
      if (!binding || binding.session.expiresAt <= new Date()) throw invalidGrant();
    }
  });
  // The provider deliberately rounds OAuth timestamps to seconds. Bind the code
  // to its original consent when it is stored, before it is sent to the client.
  // The millisecond issuance timestamp also distinguishes an immediate reconnect.
  async function beforeVerificationCreate<T extends { value: string; createdAt: Date }>(verification: T) {
    let value: unknown;
    try { value = JSON.parse(verification.value); } catch { return { data: verification }; }
    const parsed = storedCodeSchema.safeParse(value);
    if (!parsed.success) return { data: verification };
    const [consent] = await db.select().from(oauthConsent).where(and(eq(oauthConsent.userId, parsed.data.userId),
      eq(oauthConsent.clientId, parsed.data.query.client_id), eq(oauthConsent.referenceId, parsed.data.referenceId)));
    if (!consent) throw invalidGrant();
    return { data: { ...verification, createdAt: new Date(), value: JSON.stringify({ ...value as object, siftConsentId: consent.id }) } };
  }
  return { plugin: mcp(options), beforeToken, beforeVerificationCreate };
}
