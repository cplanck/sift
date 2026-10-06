import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import pg from "pg";
import { S3Client, CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { applyPlan, captureSnapshot, planSync, readContent, summarizePlan } from "./lib/production-sync.mjs";

const { values: options } = parseArgs({ options: {
  apply: { type: "boolean", default: false }, json: { type: "boolean", default: false }, email: { type: "string" }, "local-email": { type: "string" },
  "source-file": { type: "string", default: ".local/production-database.json" },
  "refresh-connection": { type: "boolean", default: false }, help: { type: "boolean" },
} });
if (options.help) {
  console.log("pnpm sync:prod [--apply] [--email you@example.com] [--refresh-connection]\nPreview by default. Copies app content into the matching local account, preserves local edits, and never writes production.\nThe production connection is kept in ignored .local/production-database.json; --source-file selects a different protected JSON file.");
  process.exit(0);
}
dotenv.config({ path: ".env.local", quiet: true });

async function writePrivate(path, data) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => {}); }
}
async function readState(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return { records: {} }; throw new Error("The local sync state could not be read."); }
}
async function refreshConnection() {
  const project = JSON.parse(await readFile(".vercel/project.json", "utf8"));
  const api = (endpoint) => {
    const result = spawnSync("pnpm", ["dlx", "vercel@62.4.0", "api", endpoint, "--scope", project.orgId], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (result.status !== 0) throw new Error("Vercel connection lookup failed. Sign in to Vercel CLI and retry; provider output was withheld.");
    return JSON.parse(result.stdout);
  };
  const metadata = api(`/v10/projects/${project.projectId}/env?decrypt=false`);
  const envs = Array.isArray(metadata) ? metadata : metadata.envs;
  const variable = envs?.find((entry) => entry.key === "DATABASE_URL" && (Array.isArray(entry.target) ? entry.target.includes("production") : entry.target === "production"));
  if (!variable?.id) throw new Error("The linked Vercel project has no production DATABASE_URL.");
  const value = api(`/v1/projects/${project.projectId}/env/${encodeURIComponent(variable.id)}`);
  if (value.key !== "DATABASE_URL" || !/^postgres(ql)?:\/\//.test(value.value ?? "")) throw new Error("Vercel did not return the requested database connection.");
  await writePrivate(options["source-file"], { DATABASE_URL: value.value });
  if (!options.json) console.log("Production connection refreshed in the private local file.");
}

let sourcePool, targetPool, client, committed = false, storage;
const copiedKeys = [];
try {
  if (options["refresh-connection"]) await refreshConnection();
  let saved;
  try { saved = JSON.parse(await readFile(options["source-file"], "utf8")); }
  catch { throw new Error("Run pnpm sync:prod --refresh-connection to retrieve the production connection from the linked Vercel project."); }
  const sourceUrl = new URL(saved.DATABASE_URL), targetUrl = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(sourceUrl.hostname.endsWith(".neon.tech"), "The source must be the Sift Neon production database.");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(targetUrl.hostname), "Sync writes are allowed only to a local database.");
  assert.ok(sourceUrl.hostname !== targetUrl.hostname, "Source and target must differ.");
  sourceUrl.searchParams.set("sslmode", "verify-full");
  sourcePool = new pg.Pool({ connectionString: sourceUrl.toString(), max: 1 });
  targetPool = new pg.Pool({ connectionString: targetUrl.toString(), max: 1 });
  if (!options.json) console.log("Reading a production snapshot in a read-only transaction…");
  const snapshot = await captureSnapshot(sourcePool, targetPool, options.email, options["local-email"]);
  const directory = join(".local/production-sync", `${snapshot.source.workspace_id}-${snapshot.target.workspace_id}`);
  const statePath = join(directory, "state.json"), state = await readState(statePath);
  client = await targetPool.connect();
  await client.query(options.apply ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  if (options.apply) await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`sift-production-sync:${snapshot.target.workspace_id}`]);
  const before = await readContent(client, snapshot.target, options.apply);
  const actions = planSync(snapshot, before, state.records);
  if (!options.json) {
    console.log(`${snapshot.target.email}: production → local`);
    console.table(Object.entries(summarizePlan(actions)).filter(([, counts]) => Object.values(counts).some(Boolean)).map(([table, counts]) => ({ table, ...counts })));
  }
  const conflicts = actions.filter((action) => action.kind === "conflict");
  if (!options.json) for (const conflict of conflicts) console.log(`Conflict: ${conflict.table} ${conflict.row.id ?? conflict.row.recipe_id}: ${conflict.reason}`);
  if (!options.apply) {
    await client.query("ROLLBACK"); client.release(); client = undefined;
    if (!options.json) console.log("Preview complete. Run pnpm sync:prod --apply to copy these changes.");
  } else {
    const backupPath = join(directory, `backup-${Date.now()}.json`);
    await writePrivate(backupPath, { capturedAt: new Date().toISOString(), owner: snapshot.target, tables: before, syncState: state });
    const copyPhoto = async (source, target) => {
      if (before.photos.some((photo) => photo.id === target.id && photo.object_key === target.object_key)) return;
      if (!storage) {
        for (const name of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) if (!process.env[name]) throw new Error("Configure local R2 storage before copying production photos.");
        storage = new S3Client({ region: "auto", endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
      }
      if (source.byte_size > 8 * 1024 * 1024) throw new Error("A source photo exceeds Sift's supported image size.");
      const bucket = process.env.R2_BUCKET;
      await storage.send(new CopyObjectCommand({ Bucket: bucket, Key: target.object_key, CopySource: `${bucket}/${source.object_key.split("/").map(encodeURIComponent).join("/")}` }), { abortSignal: AbortSignal.timeout(20000) });
      copiedKeys.push(target.object_key);
    };
    const records = await applyPlan(client, snapshot, actions, copyPhoto);
    await client.query("COMMIT"); committed = true;
    await writePrivate(statePath, { sourceWorkspaceId: snapshot.source.workspace_id, targetWorkspaceId: snapshot.target.workspace_id, syncedAt: new Date().toISOString(), records: { ...state.records, ...records } });
    if (!options.json) console.log(`Local content synced. Backup: ${backupPath}`);
    if (!options.json && conflicts.length) console.log(`${conflicts.length} conflicting records were preserved for review.`);
  }
  if (options.json) console.log(JSON.stringify({ applied: options.apply, summary: summarizePlan(actions), conflicts: conflicts.map(({ table, reason }) => ({ table, reason })) }));
} catch (error) {
  if (client && !committed) await client.query("ROLLBACK").catch(() => {});
  if (!committed && storage) await Promise.allSettled(copiedKeys.map((key) => storage.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }))));
  console.error(`Sync stopped: ${error.message}`);
  if (committed) console.error("Local data was committed, but sync bookkeeping failed. Keep the backup and retry the preview before continuing.");
  process.exitCode = 1;
} finally {
  client?.release();
  await sourcePool?.end(); await targetPool?.end(); storage?.destroy();
}
