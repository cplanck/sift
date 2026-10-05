import { createHash, randomBytes } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { clientHeaders, expect, test as base } from "./fixtures";

const origin = "http://localhost:3100", resource = `${origin}/api/mcp`, headers = { Origin: origin };
const password = "a-good-test-password-42";
const test = base.extend<{ externalRequest: APIRequestContext }>({
  externalRequest: async ({ playwright }, provide) => {
    // The external OAuth client has no Sift browser cookies. Keep the real
    // cookie-request CSRF checks enabled on token and refresh endpoints.
    const request = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: clientHeaders() });
    try { await provide(request); } finally { await request.dispose(); }
  },
});
async function register(request: APIRequestContext, scopes: string[], name = "Cookbook companion") {
  const callback = `${origin}/mcp-test-callback/${crypto.randomUUID()}`;
  const registered = await request.post("/api/auth/oauth2/register", { headers, data: {
    client_name: name, redirect_uris: [callback], token_endpoint_auth_method: "none", application_type: "native",
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: scopes.join(" "), resources: [resource],
  } });
  expect(registered.ok(), await registered.text()).toBe(true);
  const client = await registered.json() as { client_id: string };
  const verifier = randomBytes(32).toString("base64url"), state = crypto.randomUUID();
  const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: "code", scope: scopes.join(" "), resource,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state });
  return { clientId: client.client_id, callback, verifier, query, state };
}
async function callbackPage(page: Page, callback: string) {
  // This is the test OAuth client's callback page, not a mocked Sift endpoint.
  await page.route(`${callback}**`, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Client callback</title><p>Returned to the requesting app.</p>" }));
}
async function exchange(request: APIRequestContext, client: Awaited<ReturnType<typeof register>>, callbackUrl: string) {
  const url = new URL(callbackUrl);
  expect(url.searchParams.get("state")).toBe(client.state);
  const code = url.searchParams.get("code"); expect(code).toBeTruthy();
  const response = await request.post("/api/auth/oauth2/token", { form: { grant_type: "authorization_code", client_id: client.clientId,
    redirect_uri: client.callback, code: code!, code_verifier: client.verifier, resource } });
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as { access_token: string; refresh_token: string; scope: string };
}
async function initialize(request: APIRequestContext, token: string) {
  return request.post("/api/mcp", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" }, data: {
    jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Sift browser QA", version: "1.0.0" } },
  } });
}
async function callTool(request: APIRequestContext, token: string, name: string, args: Record<string, unknown>) {
  const response = await request.post("/api/mcp", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
    data: { jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name, arguments: args } } });
  expect(response.ok()).toBe(true);
  const raw = await response.text();
  const message = response.headers()["content-type"]?.includes("text/event-stream") ? JSON.parse(raw.split("\n").find((line) => line.startsWith("data: "))!.slice(6)) : JSON.parse(raw);
  expect(message.error).toBeUndefined();
  expect(message.result.isError).not.toBe(true);
  return message.result.structuredContent;
}

test("an external app can sign up, request exact permissions, connect and be revoked from Settings", async ({ page, context, browser, externalRequest }, testInfo) => {
  test.setTimeout(60000);
  const scopes = ["recipes:read", "recipes:write", "offline_access"], name = "Recipe companion <trusted by nobody>";
  const client = await register(page.request, scopes, name);
  await callbackPage(page, client.callback);
  await page.goto(`/api/auth/oauth2/authorize?${client.query}`);
  await expect(page).toHaveURL(/\/sign-in\?/);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New here? Create an account", exact: true }).click();
  await page.getByLabel("Your name", { exact: true }).fill("Connected cook");
  await page.getByLabel("Email", { exact: true }).fill(`mcp-${crypto.randomUUID()}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create cookbook", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Give this app access?", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const permissions = page.getByRole("list", { name: "Requested permissions", exact: true });
  await expect(permissions.getByRole("listitem")).toHaveCount(3);
  await expect(permissions.getByText("Read your recipes", { exact: true })).toBeVisible();
  await expect(permissions.getByText("Add and update recipes", { exact: true })).toBeVisible();
  await expect(permissions.getByText("Stay connected", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/oauth-consent-${testInfo.project.name}.png`, fullPage: true });
  // A failed network request must not look like an approved connection.
  await context.setOffline(true);
  await page.getByRole("button", { name: "Allow access", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow access", exact: true })).toBeEnabled();
  await context.setOffline(false);
  expect(await (await page.request.get("/api/mcp-connections")).json()).toEqual([]);
  await page.getByRole("button", { name: "Allow access", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${client.callback.replaceAll("/", "\\/")}\\?`));
  const token = await exchange(externalRequest, client, page.url());
  expect(token.scope.split(" ").sort()).toEqual(scopes.toSorted());
  expect((await initialize(externalRequest, token.access_token)).status()).toBe(200);
  const connectionsResponse = await page.request.get("/api/mcp-connections");
  expect(connectionsResponse.headers()["cache-control"]).toContain("no-store");
  const connections = await connectionsResponse.json() as { id: string; clientId: string; name: string; scopes: string[] }[];
  expect(connections).toHaveLength(1);
  expect(connections[0]).toMatchObject({ clientId: client.clientId, name });
  expect(connections[0].scopes.toSorted()).toEqual(scopes.toSorted());
  expect(JSON.stringify(connections)).not.toContain(token.access_token);
  expect(JSON.stringify(connections)).not.toContain(token.refresh_token);
  const outsider = await browser.newContext({ baseURL: origin, extraHTTPHeaders: clientHeaders() });
  try {
    expect((await outsider.request.get("/api/mcp-connections")).status()).toBe(401);
    expect((await outsider.request.post("/api/auth/sign-up/email", { headers, data: { name: "Other cook", email: `mcp-other-${crypto.randomUUID()}@example.test`, password } })).ok()).toBe(true);
    expect(await (await outsider.request.get("/api/mcp-connections")).json()).toEqual([]);
    expect((await outsider.request.delete(`/api/mcp-connections/${connections[0].id}`, { headers })).status()).toBe(404);
  } finally { await outsider.close(); }
  expect((await page.request.delete(`/api/mcp-connections/${connections[0].id}`, { headers: { Origin: "https://unrelated.example" } })).status()).toBe(400);
  const content = { title: "Morning pour-over coffee", servings: 1, ingredientSections: [{ name: "Coffee", items: [{ text: "20 g ground coffee" }, { text: "320 g water" }] }], instructionSections: [{ name: "Brew", steps: ["Rinse the filter, then add coffee.", "Bloom with 40 g water for 30 seconds, then pour the remaining water slowly."] }] };
  const draft = await callTool(externalRequest, token.access_token, "create_recipe", { requestId: crypto.randomUUID(), content, sourceName: "Our coffee conversation" });
  expect(draft).toMatchObject({ status: "draft", reviewRequired: true, importStatus: "review" });
  await page.goto("/library");
  await page.getByRole("link", { name: /Recipe from a connected app Ready to review/ }).click();
  await expect(page).toHaveURL(draft.reviewUrl);
  await expect(page.getByRole("heading", { name: "Review your recipe.", exact: true })).toBeVisible();
  await expect(page.getByText(/Imported through MCP/)).toBeVisible();
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(page.getByRole("heading", { name: content.title, exact: true })).toBeVisible();
  const savedRecipe = await callTool(externalRequest, token.access_token, "get_recipe", { recipeId: draft.recipeId });
  expect(savedRecipe).toMatchObject({ recipeId: draft.recipeId, content });
  await page.goto("/library");
  await page.getByLabel("Your account", { exact: true }).click();
  await page.getByRole("button", { name: "Sift settings", exact: true }).click();
  const connectedApps = page.getByRole("region", { name: "Connected apps", exact: true });
  await expect(connectedApps.getByText(name, { exact: true })).toBeVisible();
  await connectedApps.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/connected-apps-${testInfo.project.name}.png` });
  await connectedApps.getByRole("button", { name: "Revoke access", exact: true }).click();
  await context.setOffline(true);
  await connectedApps.getByRole("button", { name: "Confirm revoke", exact: true }).click();
  await expect(connectedApps.getByRole("alert")).toBeVisible();
  await expect(connectedApps.getByText(name, { exact: true })).toBeVisible();
  await context.setOffline(false);
  await connectedApps.getByRole("button", { name: "Confirm revoke", exact: true }).click();
  await expect(connectedApps.getByText("No apps connected yet.", { exact: true })).toBeVisible();
  expect(await (await page.request.get("/api/mcp-connections")).json()).toEqual([]);
  expect((await initialize(externalRequest, token.access_token)).status()).toBe(401);
  const refresh = await externalRequest.post("/api/auth/oauth2/token", { form: { grant_type: "refresh_token", client_id: client.clientId, refresh_token: token.refresh_token, resource } });
  expect(refresh.status()).toBe(400);
  expect((await refresh.json()).error).toBe("invalid_grant");
});

test("signed reauthentication continues to exact read-only consent; denial and tampered requests grant nothing", async ({ page }) => {
  const email = `mcp-deny-${crypto.randomUUID()}@example.test`;
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { name: "Careful cook", email, password } })).ok()).toBe(true);
  const client = await register(page.request, ["recipes:read"]);
  client.query.set("prompt", "login consent");
  await callbackPage(page, client.callback);
  await page.goto(`/api/auth/oauth2/authorize?${client.query}`);
  // A session already exists, but prompt=login must still show the sign-in form.
  await expect(page).toHaveURL(/\/sign-in\?/);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Give this app access?", exact: true })).toBeVisible();
  const consentUrl = page.url();
  await expect(page.getByRole("list", { name: "Requested permissions", exact: true }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText("Add and update recipes", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(page).toHaveURL(/error=access_denied/);
  expect(new URL(page.url()).searchParams.get("state")).toBe(client.state);
  expect(await (await page.request.get("/api/mcp-connections")).json()).toEqual([]);
  const tampered = new URL(consentUrl); tampered.searchParams.set("scope", "recipes:read recipes:write");
  await page.goto(tampered.toString());
  await expect(page.getByRole("heading", { name: "This connection request isn’t valid.", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow access", exact: true })).toHaveCount(0);
  await expect(page.getByText("Cookbook companion", { exact: true })).toHaveCount(0);
  await page.goto("/sign-in?client_id=untrusted&sig=invalid&redirect_uri=https%3A%2F%2Fevil.example");
  await expect(page.getByRole("heading", { name: "This connection request isn’t valid.", exact: true })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
  await page.goto("/sign-in?returnTo=https%3A%2F%2Fevil.example");
  await expect(page).toHaveURL(`${origin}/library`);
});
