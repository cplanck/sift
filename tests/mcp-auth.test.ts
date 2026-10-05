import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { connectDatabase } from "@/db/connection";
import { oauthClient, oauthConsent, oauthRefreshToken, sessions, users, workspaceMembers } from "@/db/schema";
import { createAuth } from "@/lib/auth-config";
import { authorizeMcpRequest } from "@/mcp/auth";
import { verifyOAuthRequest } from "@/mcp/oauth-request";
import { listMcpConnections, revokeMcpConnection } from "@/services/mcp-connections";
import { ensurePersonalWorkspace } from "@/services/workspaces";
import { testAuthSecret, testDatabaseUrl } from "./database";

// Only the public document transport is fixture-backed. The real CIMD resolver,
// registration policy, signed consent, token issuance and bearer verifier run.
vi.mock("@better-auth/cimd/node", async (importOriginal) => {
  const original = await importOriginal<typeof import("@better-auth/cimd/node")>();
  return { ...original, fetchClientMetadataResource: async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "client.sift-tests.example") return original.fetchClientMetadataResource(input, init);
    return Response.json({ client_id: url.href, client_name: "CIMD recipe companion", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
    { headers: { "Cache-Control": "max-age=300" } });
  } };
});

const { db, pool } = connectDatabase(testDatabaseUrl);
const secret = testAuthSecret;
let baseURL: string, authInstance: ReturnType<typeof createAuth>, server: Server;
let clientId: string, cookie: string, userId: string, workspaceId: string;
const clientIds: string[] = [], userIds: string[] = [];
const callback = "https://claude.ai/api/mcp/auth_callback";
const resource = () => `${baseURL}/api/mcp`;
const request = (path: string, init?: RequestInit) => authInstance.handler(new Request(`${baseURL}${path}`, init));
async function jsonRequest(path: string, body: unknown, sessionCookie?: string) {
  return request(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: baseURL,
    ...(sessionCookie ? { Cookie: sessionCookie } : {}) }, body: JSON.stringify(body) });
}
async function location(response: Response) {
  const redirect = response.headers.get("location");
  if (redirect) return redirect;
  const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBe(200);
  expect(typeof data.url, JSON.stringify(data)).toBe("string");
  return data.url as string;
}
async function createCode(scopes = "recipes:read recipes:write offline_access", accept = true) {
  const verifier = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: "code", scope: scopes,
    code_challenge: challenge, code_challenge_method: "S256", resource: resource(), state: randomUUID(), prompt: "consent" });
  const consentURL = new URL(await location(await request(`/api/auth/oauth2/authorize?${params}`, { headers: { Cookie: cookie, Accept: "application/json" } })), baseURL);
  expect(consentURL.pathname).toBe("/consent");
  const oauthQuery = consentURL.search.slice(1);
  const verified = await verifyOAuthRequest(db, { secret, baseURL }, oauthQuery);
  expect(verified.clientId).toBe(clientId);
  const finalURL = new URL(await location(await jsonRequest("/api/auth/oauth2/consent", { accept, oauth_query: oauthQuery }, cookie)));
  expect(finalURL.origin + finalURL.pathname).toBe(callback);
  expect(finalURL.searchParams.get("state")).toBe(params.get("state"));
  return { code: finalURL.searchParams.get("code")!, verifier, oauthQuery, finalURL };
}
async function exchange(code: string, verifier: string, overrides: Record<string, string> = {}) {
  return request("/api/auth/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: callback, resource: resource(), ...overrides }) });
}
async function tokens(scopes?: string) {
  const { code, verifier } = await createCode(scopes);
  const response = await exchange(code, verifier);
  const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBe(200);
  expect(typeof data.access_token).toBe("string");
  return data as { access_token: string; refresh_token?: string; scope: string };
}
async function access(token?: string, extraHeaders: Record<string, string> = {}) {
  return authorizeMcpRequest(new Request(resource(), { method: "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders } }),
    async (_request, principal) => Response.json(principal), { auth: authInstance, db, baseURL });
}
async function refresh(token: string) {
  return request("/api/auth/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: token, resource: resource() }) });
}

beforeAll(async () => {
  server = createServer(async (incoming, outgoing) => {
    try {
      const response = await authInstance.handler(new Request(`${baseURL}${incoming.url}`, { method: incoming.method }));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test listener.");
  baseURL = `http://127.0.0.1:${address.port}`;
  authInstance = createAuth(db, { secret, baseURL });
  const signup = await jsonRequest("/api/auth/sign-up/email", { email: `${randomUUID()}@example.test`, password: "sufficiently-long-test-password", name: "MCP cook" });
  expect(signup.status).toBe(200);
  cookie = signup.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const signupData = await signup.json(); userId = signupData.user.id; userIds.push(userId);
  workspaceId = await ensurePersonalWorkspace(db, userId);
  const registration = await jsonRequest("/api/auth/oauth2/register", { client_name: "Claude integration test", redirect_uris: [callback],
    token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: "recipes:read recipes:write offline_access" });
  const data = await registration.json();
  expect(registration.status, JSON.stringify(data)).toBe(201);
  clientId = data.client_id; clientIds.push(clientId);
});
afterAll(async () => {
  await db.delete(oauthClient).where(inArray(oauthClient.clientId, clientIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await pool.end();
});

describe("real Better Auth MCP authorization", () => {
  it("publishes audience-bound discovery, CIMD, S256 and a real 401 challenge", async () => {
    const metadata = await (await request("/.well-known/oauth-authorization-server/api/auth")).json();
    expect(metadata.issuer).toBe(`${baseURL}/api/auth`);
    expect(metadata.client_id_metadata_document_supported).toBe(true);
    expect(metadata.token_endpoint_auth_methods_supported).toContain("none");
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.grant_types_supported).not.toContain("client_credentials");
    const protectedResource = await (await request("/.well-known/oauth-protected-resource/api/mcp")).json();
    expect(protectedResource.resource).toBe(resource());
    expect(protectedResource.scopes_supported).toEqual(["recipes:read", "recipes:write"]);
    const denied = await access(undefined, { Cookie: cookie });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toContain("resource_metadata=");
  });
  it("completes approval, PKCE exchange and refresh with trusted workspace and scopes", async () => {
    const issued = await tokens();
    const response = await access(issued.access_token);
    expect(response.status).toBe(200);
    const principal = await response.json();
    expect(principal.actor).toEqual({ userId, workspaceId });
    expect(principal.clientId).toBe(clientId);
    expect(principal.scopes).toEqual(expect.arrayContaining(["recipes:read", "recipes:write"]));
    expect(issued.refresh_token).toBeTruthy();
    const refreshed = await refresh(issued.refresh_token!);
    expect(refreshed.status, JSON.stringify(await refreshed.clone().json())).toBe(200);
    expect((await access((await refreshed.json()).access_token)).status).toBe(200);
    const stored = await db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.clientId, clientId));
    expect(stored.every((token) => token.token !== issued.refresh_token)).toBe(true);
    // Playwright opens another auth instance against the same test database.
    // It must be able to decrypt the signing keys this instance persisted.
    const browserAuth = createAuth(db, { secret: testAuthSecret, baseURL: "http://localhost:3100" });
    const browserToken = await browserAuth.api.signJWT({ body: { payload: { sub: userId } } });
    expect(typeof browserToken.token).toBe("string");
  });
  it("rejects altered signatures, browser origins, redirect/resource changes and wrong PKCE", async () => {
    const issued = await tokens("recipes:read");
    expect((await access(issued.access_token + "x")).status).toBe(401);
    expect((await access(issued.access_token, { Origin: "https://attacker.example" })).status).toBe(403);
    expect((await access(issued.access_token, { Host: "attacker.example" })).status).toBe(403);
    const claims = JSON.parse(Buffer.from(issued.access_token.split(".")[1], "base64url").toString()) as Record<string, unknown>;
    for (const overrides of [{ aud: "https://attacker.example/api/mcp" }, { iss: "https://attacker.example/api/auth" }, { exp: 1 }, { scope: "recipes:read recipes:write" }]) {
      const signed = await authInstance.api.signJWT({ body: { payload: { ...claims, ...overrides } } });
      expect((await access(signed.token)).status).toBe(401);
    }
    const first = await createCode();
    expect((await exchange(first.code, "wrong-verifier-that-is-long-enough-to-be-a-valid-string" )).status).toBe(401);
    const second = await createCode();
    expect((await exchange(second.code, second.verifier, { redirect_uri: "https://attacker.example/callback" })).status).toBe(400);
    const third = await createCode();
    expect((await exchange(third.code, third.verifier, { resource: "https://attacker.example/api/mcp" })).status).toBe(400);
    await expect(verifyOAuthRequest(db, { secret, baseURL }, third.oauthQuery.replace("recipes%3Aread", "admin%3Aall"))).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("rejects missing PKCE and unregistered callbacks before sending an authorization code", async () => {
    const query = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: "code", scope: "recipes:read", resource: resource() });
    const missingPkce = await request(`/api/auth/oauth2/authorize?${query}`, { headers: { Cookie: cookie, Accept: "application/json" } });
    const body = await missingPkce.json();
    expect(new URL(body.url, baseURL).searchParams.get("error")).toBeTruthy();
    expect(new URL(body.url, baseURL).searchParams.has("code")).toBe(false);
    query.set("redirect_uri", "https://attacker.example/callback");
    query.set("code_challenge", createHash("sha256").update("a".repeat(64)).digest("base64url"));
    query.set("code_challenge_method", "S256");
    const unregistered = await request(`/api/auth/oauth2/authorize?${query}`, { headers: { Cookie: cookie, Accept: "application/json" } });
    expect(unregistered.headers.get("location") ?? "").not.toContain("attacker.example");
    expect(await unregistered.text()).not.toContain('"code":');
  });
  it("keeps denial explicit and read-only consent read-only", async () => {
    const denied = await createCode("recipes:read", false);
    expect(denied.finalURL.searchParams.get("error")).toBe("access_denied");
    expect(denied.code).toBeNull();
    const issued = await tokens("recipes:read");
    expect((await (await access(issued.access_token)).json()).scopes).toEqual(["recipes:read"]);
    expect(issued.refresh_token).toBeUndefined();
  });
  it("revokes old JWTs, refresh tokens and pending codes across later re-consent", async () => {
    const issued = await tokens();
    const pending = await createCode();
    const connections = await listMcpConnections(db, { userId, workspaceId });
    const connection = connections.find((item) => item.clientId === clientId)!;
    expect(connection.name).toBe("Claude integration test");
    await revokeMcpConnection(db, { userId, workspaceId }, connection.id);
    expect((await access(issued.access_token)).status).toBe(401);
    expect((await refresh(issued.refresh_token!)).status).toBe(400);
    const renewed = await tokens();
    expect((await access(renewed.access_token)).status).toBe(200);
    expect((await access(issued.access_token)).status).toBe(401);
    expect((await exchange(pending.code, pending.verifier)).status).toBe(400);
  });
  it("authorizes a public CIMD client without dynamic registration and preserves revocation", async () => {
    const registeredClientId = clientId;
    clientId = `https://client.sift-tests.example/${randomUUID()}.json`;
    clientIds.push(clientId);
    try {
      const issued = await tokens("recipes:read offline_access");
      const principal = await (await access(issued.access_token)).json();
      expect(principal).toMatchObject({ actor: { userId, workspaceId }, clientId, clientName: "CIMD recipe companion" });
      const [storedClient] = await db.select().from(oauthClient).where(eq(oauthClient.clientId, clientId));
      expect(storedClient.clientDiscoveryId).toBe("cimd");
      expect(storedClient.tokenEndpointAuthMethod).toBe("none");
      expect((await refresh(issued.refresh_token!)).status).toBe(200);
      await revokeMcpConnection(db, { userId, workspaceId }, principal.consentId);
      expect((await access(issued.access_token)).status).toBe(401);
    } finally { clientId = registeredClientId; }
  });
  it("checks disabled clients, current membership, session expiry and connection ownership", async () => {
    const issued = await tokens();
    const principal = await (await access(issued.access_token)).json();
    await db.update(oauthClient).set({ disabled: true }).where(eq(oauthClient.clientId, clientId));
    expect((await access(issued.access_token)).status).toBe(401);
    await db.update(oauthClient).set({ disabled: false }).where(eq(oauthClient.clientId, clientId));
    const stranger = randomUUID(); userIds.push(stranger);
    await db.insert(users).values({ id: stranger, name: "Other cook", email: `${stranger}@example.test` });
    const strangerWorkspace = await ensurePersonalWorkspace(db, stranger);
    await expect(revokeMcpConnection(db, { userId: stranger, workspaceId: strangerWorkspace }, principal.consentId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(revokeMcpConnection(db, { userId, workspaceId }, "-".repeat(36))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listMcpConnections(db, { userId: stranger, workspaceId: strangerWorkspace })).toEqual([]);
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
    expect((await access(issued.access_token)).status).toBe(401);
    await db.insert(workspaceMembers).values({ userId, workspaceId, role: "owner" });
    await db.update(sessions).set({ expiresAt: new Date(0) }).where(eq(sessions.id, principal.sessionId));
    expect((await access(issued.access_token)).status).toBe(401);
    expect((await refresh(issued.refresh_token!)).status).toBe(400);
    expect(await db.select().from(oauthConsent).where(eq(oauthConsent.id, principal.consentId))).toHaveLength(1);
  });
});
