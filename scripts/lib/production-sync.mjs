import { createHash } from "node:crypto";
import assert from "node:assert/strict";

export const contentTables = ["recipes", "recipe_versions", "cooking_sessions", "cooking_session_notes", "photos", "recipe_notes", "recipe_favorites", "recipe_imports", "artifacts", "conversations", "conversation_turns", "conversation_tool_calls", "ai_usage", "voice_sessions", "voice_turns"];
const ownerQuery = "SELECT u.id,u.email,u.name,w.id AS workspace_id FROM users u JOIN workspaces w ON w.personal_for_user_id=u.id";
const predicate = (table) => {
  if (table === "conversation_turns" || table === "conversation_tool_calls") return "conversation_id IN (SELECT id FROM conversations WHERE workspace_id=$1 AND created_by_user_id=$2)";
  if (table === "voice_turns") return "voice_session_id IN (SELECT id FROM voice_sessions WHERE workspace_id=$1 AND user_id=$2)";
  if (table === "conversations") return "workspace_id=$1 AND created_by_user_id=$2";
  if (["recipe_favorites", "ai_usage", "voice_sessions"].includes(table)) return "workspace_id=$1 AND user_id=$2";
  return "workspace_id=$1";
};

export async function readContent(client, owner, lock = false) {
  /** @type {Record<string, Record<string, unknown>[]>} */
  const tables = {};
  for (const table of contentTables) {
    const where = predicate(table);
    tables[table] = (await client.query(`SELECT * FROM "${table}" WHERE ${where}${lock ? " FOR UPDATE" : ""}`, where.includes("$2") ? [owner.workspace_id, owner.id] : [owner.workspace_id])).rows;
  }
  return tables;
}

export async function captureSnapshot(production, local, email, localEmail) {
  const sourceClient = await production.connect();
  try {
    await sourceClient.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await sourceClient.query("SET LOCAL statement_timeout = '30s'");
    assert.equal((await sourceClient.query("SHOW transaction_read_only")).rows[0].transaction_read_only, "on");
    const filter = email ? " WHERE lower(u.email)=lower($1)" : "";
    const sourceUsers = (await sourceClient.query(ownerQuery + filter, email ? [email] : [])).rows;
    const targetEmail = localEmail ?? email;
    const localUsers = (await local.query(ownerQuery + (targetEmail ? " WHERE lower(u.email)=lower($1)" : ""), targetEmail ? [targetEmail] : [])).rows;
    const matches = sourceUsers.flatMap((source) => localUsers.filter((target) => localEmail || target.email.toLowerCase() === source.email.toLowerCase()).map((target) => ({ source, target })));
    if (matches.length !== 1) throw new Error("Choose one matching production/local account with --email your@email.com.");
    const { source, target } = matches[0];
    assert.notEqual(source.workspace_id, target.workspace_id, "Source and target workspaces must differ.");
    const tables = await readContent(sourceClient, source);
    const columns = (await sourceClient.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY table_name,ordinal_position", [contentTables])).rows;
    return { capturedAt: new Date().toISOString(), productionReadOnly: true, source, target, tables, columns };
  } finally { await sourceClient.query("ROLLBACK"); sourceClient.release(); }
}

function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
export function rowHash(row) { return createHash("sha256").update(JSON.stringify(canonical(row))).digest("hex"); }

export function mappedId(snapshot, id) {
  const bytes = createHash("sha256").update(`sift-production-sync-v1:${snapshot.source.workspace_id}:${snapshot.target.workspace_id}:${id}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const keyFor = (table, row) => table === "recipe_favorites" ? `${row.recipe_id}:${row.user_id}` : row.id;

function mapContent(snapshot) {
  const ids = new Map([[snapshot.source.id, snapshot.target.id], [snapshot.source.workspace_id, snapshot.target.workspace_id]]);
  for (const rows of Object.values(snapshot.tables)) for (const row of rows) if (row.id) ids.set(row.id, mappedId(snapshot, row.id));
  const remap = (value) => {
    if (value instanceof Date) return value;
    if (typeof value === "string") return ids.get(value) ?? value.replace(/https:\/\/sift-roan\.vercel\.app(?=\/(recipes|artifacts)\/)/g, "http://localhost:3003").replace(/\/(recipes|artifacts)\/([\da-f-]{36})/gi, (link, kind, id) => ids.has(id) ? `/${kind}/${ids.get(id)}` : link);
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, remap(entry)]));
    return value;
  };
  return Object.fromEntries(contentTables.map((table) => [table, snapshot.tables[table].map((source) => {
    const row = remap(source);
    for (const column of ["created_by_user_id", "updated_by_user_id", "started_by_user_id", "user_id"]) if (row[column]) row[column] = snapshot.target.id;
    if (table === "conversations") { row.active_run_id = null; row.lease_expires_at = null; }
    if (["conversation_turns", "voice_turns"].includes(table) && row.status === "running") { row.status = "aborted"; row.finished_at = row.created_at; }
    if (table === "voice_sessions") {
      row.auth_session_id = null; row.active_run_id = null;
      row.expires_at = new Date(0); row.lease_expires_at = new Date(0);
      if (["ready", "preparing"].includes(row.status)) { row.status = "ended"; row.ended_at = row.updated_at; }
    }
    if (table === "recipe_imports" && ["queued", "processing"].includes(row.status)) { row.status = "failed"; row.error_message = "Copied while processing in production. Retry this import locally to run it here."; }
    if (table === "ai_usage") row.idempotency_key = `production-sync:${row.id}`;
    if (table === "photos") {
      const prefix = source.status === "ready" ? `workspaces/${snapshot.source.workspace_id}/` : `uploads/workspaces/${snapshot.source.workspace_id}/`;
      if (!source.object_key.startsWith(prefix)) throw new Error("A source photo is outside the selected workspace.");
      const folder = source.status === "ready" ? "workspaces" : "uploads/workspaces";
      const digest = createHash("sha256").update(source.object_key).digest("hex").slice(0, 16);
      row.object_key = `${folder}/${snapshot.target.workspace_id}/photos/${row.id}/sync-${digest}`;
    }
    return row;
  })]));
}

export function planSync(snapshot, localTables, baseline = {}) {
  const mapped = mapContent(snapshot), actions = [];
  for (const table of contentTables) {
    const existing = new Map(localTables[table].map((row) => [keyFor(table, row), row]));
    for (const row of mapped[table]) {
      const key = `${table}:${keyFor(table, row)}`, before = existing.get(keyFor(table, row));
      const hash = rowHash(row), previousHash = before && rowHash(before);
      let kind = !before ? "insert" : hash === previousHash ? "unchanged" : baseline[key] === previousHash ? "update" : "conflict";
      let reason = kind === "conflict" ? "Local content changed or has no sync baseline." : undefined;
      if (table === "recipe_versions" && !before && localTables.recipe_versions.some((version) => version.recipe_id === row.recipe_id && version.number === row.number)) { kind = "conflict"; reason = "A local recipe version uses this version number."; }
      actions.push({ table, key, row, before, hash, kind, reason });
    }
  }
  const conflictedRecipes = new Set(actions.filter((action) => action.kind === "conflict" && ["recipes", "recipe_versions"].includes(action.table)).map((action) => action.table === "recipes" ? action.row.id : action.row.recipe_id));
  for (const action of actions) if (["insert", "update"].includes(action.kind) && conflictedRecipes.has(action.table === "recipes" ? action.row.id : action.row.recipe_id)) { action.kind = "conflict"; action.reason = "This recipe has conflicting local edits."; }
  const contains = (value, unavailable) => typeof value === "string" ? unavailable.has(value) : Array.isArray(value) ? value.some((item) => contains(item, unavailable)) : !!value && typeof value === "object" && Object.values(value).some((item) => contains(item, unavailable));
  let changed = true;
  while (changed) {
    changed = false;
    const unavailable = new Set(actions.filter((action) => action.kind === "conflict" && !action.before).map((action) => action.row.id).filter(Boolean));
    for (const action of actions) if (["insert", "update"].includes(action.kind) && contains(action.row, unavailable)) { action.kind = "conflict"; action.reason = "A required copied record has a conflict."; changed = true; }
  }
  return actions;
}

export function summarizePlan(actions) {
  return Object.fromEntries(contentTables.map((table) => [table, Object.fromEntries(["insert", "update", "unchanged", "conflict"].map((kind) => [kind, actions.filter((action) => action.table === table && action.kind === kind).length]))]));
}

export async function applyPlan(client, snapshot, actions, copyPhoto) {
  const columnTypes = new Map(snapshot.columns.map((column) => [`${column.table_name}:${column.column_name}`, column.data_type]));
  for (const action of actions.filter((action) => ["insert", "update"].includes(action.kind))) {
    const { table, kind } = action;
    const row = { ...action.row };
    if (table === "recipes") { row.current_version_id = null; row.cover_photo_id = null; }
    if (table === "photos") {
      const source = snapshot.tables.photos.find((photo) => mappedId(snapshot, photo.id) === row.id);
      if (!copyPhoto) throw new Error("Photo storage is required to copy this workspace's photos.");
      await copyPhoto(source, row);
    }
    const columns = Object.keys(row);
    for (const column of columns) if (!/^[a-z_]+$/.test(column) || !columnTypes.has(`${table}:${column}`)) throw new Error("Source and local schemas must match before syncing.");
    const values = columns.map((column) => ["json", "jsonb"].includes(columnTypes.get(`${table}:${column}`)) ? JSON.stringify(row[column]) : row[column]);
    const primary = table === "recipe_favorites" ? ["recipe_id", "user_id"] : ["id"];
    if (kind === "insert") await client.query(`INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(",")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(",")})`, values);
    else {
      const set = columns.map((column, index) => `"${column}"=$${index + 1}`).join(",");
      await client.query(`UPDATE "${table}" SET ${set} WHERE ${primary.map((column, index) => `"${column}"=$${values.length + index + 1}`).join(" AND ")}`, [...values, ...primary.map((column) => row[column])]);
    }
  }
  for (const action of actions.filter((action) => action.table === "recipes" && ["insert", "update"].includes(action.kind))) await client.query("UPDATE recipes SET current_version_id=$1,cover_photo_id=$2 WHERE id=$3 AND workspace_id=$4", [action.row.current_version_id, action.row.cover_photo_id, action.row.id, snapshot.target.workspace_id]);
  const baseline = {};
  for (const action of actions.filter((action) => action.kind !== "conflict")) baseline[action.key] = action.hash;
  return baseline;
}
