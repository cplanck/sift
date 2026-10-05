import { createHash } from "node:crypto";
import type { Database } from "@/db/connection";
import { DomainError } from "@/domain/errors";
import { mcpCreateRecipeSchema, mcpGetRecipeSchema, mcpSearchRecipesSchema, mcpSourceClientSchema, mcpUpdateRecipeSchema, type McpSourceClient } from "@/domain/mcp";
import { env } from "@/lib/env";
import { createStructuredImport } from "./imports";
import { getRecipe, listRecipes, updateRecipe } from "./recipes";
import type { Actor } from "./workspaces";

// Even a maximum-length step containing escaped control characters fits in one
// page, so every continuation advances without splitting human-authored text.
const maxRecipeBytes = 64 * 1024, pageBytes = 40 * 1024;
const appUrl = (path: string) => new URL(path, env().BETTER_AUTH_URL).href;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
function validateSize(value: unknown) {
  if (bytes(value) > maxRecipeBytes) throw new DomainError("INVALID_INPUT", "This recipe is too large for an MCP write. Keep its structured content under 64 KB, or review it in Sift.");
}
function importId(actor: Actor, clientId: string, requestId: string) {
  // A namespace-derived UUID (version 8) makes retries idempotent without
  // accepting an external workspace ID or exposing cross-client request IDs.
  const hash = createHash("sha256").update(JSON.stringify(["sift:mcp:import:v1", actor.workspaceId, actor.userId, clientId, requestId])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x80; hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function createMcpRecipe(db: Database, actor: Actor, client: McpSourceClient, input: unknown) {
  const data = mcpCreateRecipeSchema.parse(input), origin = mcpSourceClientSchema.parse(client);
  const original = { transport: "mcp", client: origin, request: data };
  validateSize(original);
  const rawText = JSON.stringify(original);
  const record = await createStructuredImport(db, actor, {
    id: importId(actor, origin.clientId, data.requestId), rawText, content: data.content,
    source: { type: "mcp", name: `${origin.clientName.slice(0, 160)} via MCP${data.sourceName ? ` · ${data.sourceName}` : ""}`, ...(data.sourceUrl ? { url: data.sourceUrl } : {}), rawText, importedAt: new Date().toISOString() },
  });
  const recipe = await getRecipe(db, actor, record.recipeId!);
  return { recipeId: recipe.id, title: recipe.version.content.title, versionId: recipe.version.id, versionNumber: recipe.version.number,
    status: recipe.status, importId: record.id, importStatus: record.status, reviewRequired: record.status !== "saved",
    reviewUrl: appUrl(`/imports/${record.id}`), recipeUrl: appUrl(`/recipes/${recipe.id}`),
    message: record.status === "saved" ? "This request was already reviewed and saved in Sift." : "Draft received. Open the review URL, check the recipe, and save it to your Library. It has not been approved yet." };
}

export async function searchMcpRecipes(db: Database, actor: Actor, input: unknown) {
  const data = mcpSearchRecipesSchema.parse(input);
  const rows = (await listRecipes(db, actor, data.query)).filter((row) => data.includeArchived || row.status !== "archived");
  const candidates = rows.slice(data.offset, data.offset + data.limit).map((row) => ({ recipeId: row.id, versionId: row.versionId, title: row.title,
    description: row.description.slice(0, 500), status: row.status, tags: row.tags, recipeUrl: appUrl(`/recipes/${row.id}`) }));
  const results = boundedRows(candidates, 0, candidates.length).rows;
  return { recipes: results, total: rows.length, offset: data.offset, nextOffset: data.offset + results.length < rows.length ? data.offset + results.length : null };
}

function boundedRows<T>(rows: T[], offset: number, limit: number) {
  let size = 0;
  const page: T[] = [];
  for (const row of rows.slice(offset, offset + limit)) {
    const rowSize = bytes(row);
    if (size + rowSize > pageBytes) break;
    size += rowSize; page.push(row);
  }
  return { rows: page, total: rows.length, offset, nextOffset: offset + page.length < rows.length ? offset + page.length : null };
}
export async function getMcpRecipe(db: Database, actor: Actor, input: unknown) {
  const data = mcpGetRecipeSchema.parse(input), recipe = await getRecipe(db, actor, data.recipeId);
  if (data.expectedVersionId && data.expectedVersionId !== recipe.version.id) throw new DomainError("CONFLICT", "This recipe changed between reads. Start again with its current version before updating it.");
  const summary = { recipeId: recipe.id, versionId: recipe.version.id, versionNumber: recipe.version.number, status: recipe.status,
    recipeUrl: appUrl(`/recipes/${recipe.id}`), reviewUrl: recipe.reviewImportId ? appUrl(`/imports/${recipe.reviewImportId}`) : null,
    source: { type: recipe.source.type, name: recipe.source.name ?? null, url: recipe.source.url && recipe.source.url.length <= 2048 ? recipe.source.url : null,
      urlOmitted: (recipe.source.url?.length ?? 0) > 2048 } };
  if (data.view === "full") {
    if (bytes(recipe.version.content) > maxRecipeBytes) return { ...summary, title: recipe.version.content.title, fullContentAvailable: false,
      message: "Read this large recipe using view ingredients and view instructions with offset/limit. Pass expectedVersionId on subsequent pages; no content has been truncated." };
    return { ...summary, fullContentAvailable: true, content: recipe.version.content };
  }
  const { ingredientSections, instructionSections, ...header } = recipe.version.content;
  if (data.view === "ingredients") {
    const rows = ingredientSections.flatMap((section, sectionIndex) => section.items.map((item, index) => ({ sectionIndex, sectionName: section.name, index, item })));
    return { ...summary, header, view: data.view, ...boundedRows(rows, data.offset, data.limit), sectionCount: ingredientSections.length };
  }
  const rows = instructionSections.flatMap((section, sectionIndex) => section.steps.map((text, index) => ({ sectionIndex, sectionName: section.name, index, text })));
  return { ...summary, header, view: data.view, ...boundedRows(rows, data.offset, data.limit), sectionCount: instructionSections.length };
}

export async function updateMcpRecipe(db: Database, actor: Actor, input: unknown) {
  const { recipeId, ...data } = mcpUpdateRecipeSchema.parse(input);
  validateSize(data.content);
  const recipe = await getRecipe(db, actor, recipeId);
  if (recipe.status === "draft") throw new DomainError("INVALID_INPUT", "Review and approve this imported draft in Sift before editing it through MCP.");
  const version = await updateRecipe(db, actor, recipeId, data);
  return { recipeId, title: version.content.title, versionId: version.id, versionNumber: version.number, changeSummary: version.changeSummary, recipeUrl: appUrl(`/recipes/${recipeId}`) };
}
