import { z } from "zod";
import { recipeContentSchema } from "@/domain/recipe";
import { scaleIngredient } from "@/domain/scaling";

export const OFFLINE_DATABASE = "sift-offline-v1";
export const OFFLINE_CHANNEL = "sift-offline";
export const OFFLINE_DISABLED = "sift-offline-disabled";
export const OFFLINE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CONTENT_BYTES = 512 * 1024, MAX_COVER_BYTES = 2 * 1024 * 1024, MAX_STORAGE_BYTES = 24 * 1024 * 1024;
const scopeSchema = z.object({ userId: z.uuid(), workspaceId: z.uuid(), sessionExpiresAt: z.iso.datetime() });
export type OfflineScope = z.infer<typeof scopeSchema>;
export type OfflineIdentity = OfflineScope & { key: string; epoch: string; expiresAt: number };
const cookingSchema = z.object({
  id: z.uuid(), status: z.enum(["active", "completed", "abandoned"]), servings: z.number().positive().max(1000),
  checkedIngredients: z.array(z.string().regex(/^\d{1,2}:\d{1,3}$/)).max(6000), checkedSteps: z.array(z.string().regex(/^\d{1,2}:\d{1,3}$/)).max(3000), currentStep: z.number().int().nonnegative().nullable(),
});
const snapshotSchema = z.object({
  recipeId: z.uuid(), versionId: z.uuid(), versionNumber: z.number().int().positive(), content: recipeContentSchema,
  coverPhotoId: z.uuid().nullable(), cooking: cookingSchema.optional(),
});
export type OfflineRecipeInput = z.infer<typeof snapshotSchema>;
export type OfflineSnapshot = OfflineRecipeInput & {
  key: string; scopeKey: string; epoch: string; captureId: string; savedAt: number; expiresAt: number; bytes: number; cover?: Blob;
  displayIngredientSections: { name: string; items: string[] }[];
};

export function offlineExpiry(scope: OfflineScope, now = Date.now()) {
  return Math.min(Date.parse(scopeSchema.parse(scope).sessionExpiresAt), now + OFFLINE_RETENTION_MS);
}
export function prepareOfflineSnapshot(input: OfflineRecipeInput, identity: OfflineIdentity, now = Date.now()): OfflineSnapshot | null {
  // Parse an explicit DTO: raw source, credentials, notes and API envelopes are
  // deliberately excluded from the offline store.
  const data = snapshotSchema.parse(input);
  const factor = (data.cooking?.servings ?? data.content.servings) / data.content.servings;
  const displayIngredientSections = data.content.ingredientSections.map((section) => ({ name: section.name, items: section.items.map((item) => scaleIngredient(item, factor)) }));
  const bytes = new TextEncoder().encode(JSON.stringify({ ...data, displayIngredientSections })).byteLength;
  if (bytes > MAX_CONTENT_BYTES || identity.expiresAt <= now) return null;
  return { ...data, displayIngredientSections, key: data.cooking ? `cooking:${data.cooking.id}` : `recipe:${data.recipeId}`, scopeKey: identity.key, epoch: identity.epoch, captureId: crypto.randomUUID(), savedAt: now, expiresAt: Math.min(identity.expiresAt, now + OFFLINE_RETENTION_MS), bytes };
}
export function retainedOfflineSnapshots(rows: OfflineSnapshot[], now = Date.now()) {
  let recipes = 0, sessions = 0, bytes = 0;
  return rows.filter((row) => row.expiresAt > now).sort((a, b) => b.savedAt - a.savedAt).filter((row) => {
    if (row.cooking ? sessions >= 8 : recipes >= 12) return false;
    if (bytes + row.bytes > MAX_STORAGE_BYTES) return false;
    bytes += row.bytes;
    if (row.cooking) sessions++; else recipes++;
    return true;
  });
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Offline storage is unavailable."));
  });
}
function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Offline storage is unavailable."));
  });
}
function isDisabled() { try { return localStorage.getItem(OFFLINE_DISABLED) === "1"; } catch { return true; } }
function announce(type: "cleared" | "changed") {
  window.dispatchEvent(new CustomEvent(OFFLINE_CHANNEL, { detail: type }));
  try { localStorage.setItem(OFFLINE_CHANNEL, JSON.stringify({ type, nonce: crypto.randomUUID() })); } catch { /* IndexedDB/BroadcastChannel may remain available. */ }
  try { if ("BroadcastChannel" in window) { const channel = new BroadcastChannel(OFFLINE_CHANNEL); channel.postMessage({ type }); channel.close(); } } catch { /* Storage events still invalidate other tabs. */ }
}

/** The caller verifies this scope against a live authenticated response first. */
export async function activateOfflineScope(input: OfflineScope, signal: AbortSignal): Promise<OfflineIdentity | null> {
  const scope = scopeSchema.parse(input), expiresAt = offlineExpiry(scope);
  if (signal.aborted || expiresAt <= Date.now()) return null;
  const db = await openDatabase();
  if (signal.aborted) { db.close(); return null; }
  const tx = db.transaction(["meta", "snapshots"], "readwrite"), done = transactionDone(tx);
  const abort = () => { try { tx.abort(); } catch { /* It may have just committed. */ } };
  signal.addEventListener("abort", abort, { once: true });
  const store = tx.objectStore("meta"), request = store.get("active");
  let identity: OfflineIdentity | null = null;
  request.onsuccess = () => {
    const previous = request.result as OfflineIdentity | undefined, key = `${scope.userId}:${scope.workspaceId}`;
    const same = previous?.key === key && previous.expiresAt > Date.now() && !isDisabled();
    if (!same) tx.objectStore("snapshots").clear();
    identity = { ...scope, key, expiresAt, epoch: same ? previous.epoch : crypto.randomUUID() };
    store.put(identity, "active");
  };
  try { await done; }
  finally { signal.removeEventListener("abort", abort); db.close(); }
  if (signal.aborted) return null;
  localStorage.removeItem(OFFLINE_DISABLED);
  announce("changed");
  return identity;
}

/** Called explicitly on sign-out; the tombstone also blocks reads if IDB fails. */
export async function clearOfflineData() {
  try { localStorage.setItem(OFFLINE_DISABLED, "1"); } catch { /* IDB clearing remains available. */ }
  announce("cleared");
  try {
    const db = await openDatabase();
    const tx = db.transaction(["meta", "snapshots"], "readwrite"), done = transactionDone(tx);
    tx.objectStore("meta").clear(); tx.objectStore("snapshots").clear();
    try { await done; } finally { db.close(); }
  } catch { /* Offline storage is best-effort; the tombstone remains in place. */ }
}

export async function offlineIdentityIsCurrent(identity: OfflineIdentity) {
  if (isDisabled() || identity.expiresAt <= Date.now()) return false;
  const db = await openDatabase();
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const request = db.transaction("meta").objectStore("meta").get("active");
      request.onsuccess = () => resolve(request.result?.key === identity.key && request.result?.epoch === identity.epoch && request.result?.expiresAt > Date.now());
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function writeSnapshot(identity: OfflineIdentity, snapshot: OfflineSnapshot, signal: AbortSignal, imageUpdate = false) {
  if (isDisabled()) return;
  const db = await openDatabase(), tx = db.transaction(["meta", "snapshots"], "readwrite"), done = transactionDone(tx);
  const active = tx.objectStore("meta").get("active");
  active.onsuccess = () => {
    if (signal.aborted || isDisabled() || active.result?.key !== identity.key || active.result?.epoch !== identity.epoch || active.result?.expiresAt <= Date.now()) return;
    const store = tx.objectStore("snapshots"), all = store.getAll();
    all.onsuccess = () => {
      const rows = all.result as OfflineSnapshot[];
      const previous = rows.find((row) => row.key === snapshot.key);
      // An older image fetch must not overwrite a newer recipe/session state.
      if (signal.aborted || (previous && previous.savedAt > snapshot.savedAt) || (imageUpdate && previous?.captureId !== snapshot.captureId)) return;
      if (!snapshot.cover && previous?.cover && previous.coverPhotoId === snapshot.coverPhotoId) {
        snapshot = { ...snapshot, cover: previous.cover, bytes: snapshot.bytes + previous.cover.size };
      }
      const retain = retainedOfflineSnapshots([...rows.filter((row) => row.key !== snapshot.key), snapshot]);
      const keys = new Set(retain.map((row) => row.key));
      for (const row of rows) if (!keys.has(row.key)) store.delete(row.key);
      if (keys.has(snapshot.key)) store.put(snapshot);
    };
  };
  try { await done; } finally { db.close(); }
}

export async function cacheOfflineRecipe(identity: OfflineIdentity, input: OfflineRecipeInput, signal: AbortSignal) {
  const snapshot = prepareOfflineSnapshot(input, identity);
  if (!snapshot || signal.aborted) return;
  await writeSnapshot(identity, snapshot, signal); // Text remains useful when an image is unavailable.
  if (!snapshot.coverPhotoId || signal.aborted || !await offlineIdentityIsCurrent(identity)) return;
  try {
    const response = await fetch(`/api/photos/${snapshot.coverPhotoId}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
    if (!response.ok || !/^image\/(webp|png|jpeg)$/.test(response.headers.get("content-type") ?? "")) return;
    const declared = Number(response.headers.get("content-length"));
    if (declared > MAX_COVER_BYTES) return;
    const blob = await response.blob();
    if (signal.aborted || blob.size > MAX_COVER_BYTES) return;
    await writeSnapshot(identity, { ...snapshot, cover: blob, bytes: snapshot.bytes + blob.size }, signal, true);
  } catch { /* A missing cover must not discard a readable recipe. */ }
}
