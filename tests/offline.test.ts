import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parsePastedRecipe } from "@/domain/import";
import { offlineExpiry, OFFLINE_RETENTION_MS, prepareOfflineSnapshot, retainedOfflineSnapshots, type OfflineIdentity, type OfflineRecipeInput, type OfflineSnapshot } from "@/lib/offline";

const now = Date.parse("2026-10-05T12:00:00Z"), userId = randomUUID(), workspaceId = randomUUID();
const identity: OfflineIdentity = { userId, workspaceId, key: `${userId}:${workspaceId}`, epoch: randomUUID(), sessionExpiresAt: new Date(now + 60_000).toISOString(), expiresAt: now + 60_000 };
const input: OfflineRecipeInput = {
  recipeId: randomUUID(), versionId: randomUUID(), versionNumber: 2, coverPhotoId: null,
  content: parsePastedRecipe("Soup\nIngredients\n1 14-oz can beans\n½ tsp salt\nInstructions\nSimmer gently.")!,
};

describe("explicit offline snapshot policy", () => {
  it("never retains data beyond authentication expiry or the bounded local retention period", () => {
    expect(offlineExpiry(identity, now)).toBe(now + 60_000);
    expect(offlineExpiry({ ...identity, sessionExpiresAt: new Date(now + 90 * 86400_000).toISOString() }, now)).toBe(now + OFFLINE_RETENTION_MS);
    expect(prepareOfflineSnapshot(input, { ...identity, expiresAt: now }, now)).toBeNull();
  });

  it("stores the exact version and safe display data without raw sources, notes, credentials or API envelopes", () => {
    const snapshot = prepareOfflineSnapshot({ ...input, source: { rawText: "private source" }, credentials: "never-store", notes: ["private note"] } as OfflineRecipeInput, identity, now)!;
    expect(snapshot.versionId).toBe(input.versionId);
    expect(snapshot.content).toEqual(input.content);
    expect(snapshot.key).toBe(`recipe:${input.recipeId}`);
    expect(JSON.stringify(snapshot)).not.toMatch(/private source|never-store|private note/);
  });

  it("pins cooking content and checkoffs, scales only its display, and preserves package sizes", () => {
    const session = { id: randomUUID(), status: "active" as const, servings: input.content.servings * 2, checkedIngredients: ["0:0"], checkedSteps: [], currentStep: 0 };
    const snapshot = prepareOfflineSnapshot({ ...input, cooking: session }, identity, now)!;
    expect(snapshot.key).toBe(`cooking:${session.id}`);
    expect(snapshot.cooking).toEqual(session);
    expect(snapshot.content).toEqual(input.content);
    expect(snapshot.displayIngredientSections[0].items).toEqual(["2 14-oz can beans", "1 tsp salt"]);
    expect(input.content.ingredientSections[0].items[0].text).toBe("1 14-oz can beans");
  });

  it("bounds recipes, sessions, expiry and total bytes while retaining the most recent snapshots", () => {
    const base = prepareOfflineSnapshot(input, identity, now)!;
    const rows: OfflineSnapshot[] = Array.from({ length: 18 }, (_, index) => ({ ...base, key: `recipe:${index}`, savedAt: now - index }));
    const sessions: OfflineSnapshot[] = Array.from({ length: 10 }, (_, index) => ({ ...base, key: `cooking:${index}`, cooking: { id: randomUUID(), status: "active", servings: 4, checkedIngredients: [], checkedSteps: [], currentStep: 0 }, savedAt: now - index }));
    const retained = retainedOfflineSnapshots([...rows, ...sessions, { ...base, key: "expired", expiresAt: now }], now);
    expect(retained.filter((row) => !row.cooking)).toHaveLength(12);
    expect(retained.filter((row) => row.cooking)).toHaveLength(8);
    expect(retained.map((row) => row.key)).not.toContain("recipe:17");
    expect(retained.map((row) => row.key)).not.toContain("expired");
    expect(retainedOfflineSnapshots(rows.map((row) => ({ ...row, bytes: 2 * 1024 * 1024 })), now)).toHaveLength(12);
    expect(retainedOfflineSnapshots(rows.map((row) => ({ ...row, bytes: 3 * 1024 * 1024 })), now)).toHaveLength(8);
  });
});
