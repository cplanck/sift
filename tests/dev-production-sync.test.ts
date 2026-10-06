import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { DomainError } from "@/domain/errors";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), actor: vi.fn(), allowed: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: Object.assign(() => {}, { [Symbol.for("nodejs.util.promisify.custom")]: mocks.execute }) }));
vi.mock("@/lib/auth", () => ({ requestActor: mocks.actor }));
vi.mock("@/lib/dev-production-sync", async (original) => ({ ...await original<typeof import("@/lib/dev-production-sync")>(), productionSyncAllowed: mocks.allowed }));
import { POST } from "@/app/api/dev/production-sync/route";

const actor = { userId: randomUUID(), workspaceId: randomUUID(), email: "owner@example.test" };
const result = { applied: false, summary: { recipes: { insert: 0, update: 0, unchanged: 1, conflict: 0 } }, conflicts: [] };
function request(body: unknown = { apply: false }, origin = "http://localhost:3003") { return new Request("http://localhost:3003/api/dev/production-sync", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3003"); vi.stubEnv("DATABASE_URL", "postgresql://local:local@localhost:55432/sift"); vi.stubEnv("VERCEL", ""); vi.stubEnv("VERCEL_ENV", "");
  mocks.execute.mockReset().mockResolvedValue({ stdout: JSON.stringify(result) });
  mocks.actor.mockReset().mockResolvedValue(actor); mocks.allowed.mockReset().mockResolvedValue(true);
});
afterEach(() => { vi.unstubAllEnvs(); });

it("blocks production/deployed environments and nonlocal databases before reading credentials or starting a sync", async () => {
  vi.stubEnv("VERCEL_ENV", "production"); expect((await POST(request())).status).toBe(404);
  vi.stubEnv("VERCEL_ENV", "preview"); expect((await POST(request())).status).toBe(404);
  vi.stubEnv("VERCEL_ENV", ""); vi.stubEnv("DATABASE_URL", "postgresql://local:local@production.example/sift"); expect((await POST(request())).status).toBe(404);
  expect(mocks.actor).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
});
it("requires sign-in, same origin and an approved local workspace", async () => {
  expect((await POST(request({}, "https://attacker.example"))).status).toBe(400);
  mocks.actor.mockRejectedValueOnce(new DomainError("UNAUTHENTICATED", "Please sign in.")); expect((await POST(request())).status).toBe(401);
  mocks.allowed.mockResolvedValue(false); expect((await POST(request())).status).toBe(404);
  expect(mocks.execute).not.toHaveBeenCalled();
});
it("binds both CLI accounts to the signed-in actor and rejects client-supplied account or file overrides", async () => {
  expect((await POST(request({ apply: true, email: "another@example.test" }))).status).toBe(400);
  const response = await POST(request()); expect(response.status).toBe(200); expect(await response.json()).toEqual(result);
  const [executable, args] = mocks.execute.mock.calls[0];
  expect(executable).toBe(process.execPath);
  expect(args.slice(1)).toEqual(["--json", "--email", actor.email, "--local-email", actor.email]);
  expect(args).not.toContain("--apply");
  await POST(request({ apply: true })); expect(mocks.execute.mock.calls[1][1]).toContain("--apply");
});
it("prevents simultaneous syncs and releases the busy state after completion", async () => {
  let release!: (value: { stdout: string }) => void, started!: () => void;
  const pending = new Promise<{ stdout: string }>((resolve) => { release = resolve; });
  const began = new Promise<void>((resolve) => { started = resolve; });
  mocks.execute.mockImplementationOnce(() => { started(); return pending; });
  const first = POST(request()); await began;
  expect((await POST(request())).status).toBe(409); expect(mocks.execute).toHaveBeenCalledTimes(1);
  release({ stdout: JSON.stringify(result) }); expect((await first).status).toBe(200);
  expect((await POST(request())).status).toBe(200);
});
it("does not expose subprocess errors, credentials or raw output", async () => {
  mocks.execute.mockRejectedValueOnce({ stderr: "private-production-credential", stdout: "private-data" });
  const response = await POST(request()); expect(response.status).toBe(502);
  expect(await response.text()).not.toMatch(/private-production-credential|private-data/);
});
it("only authorizes workspaces with a trusted prior CLI sync", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dev-production-sync")>("@/lib/dev-production-sync");
  const directory = await mkdtemp(join(tmpdir(), "sift-dev-sync-"));
  try {
    expect(await actual.productionSyncAllowed(actor.workspaceId, directory)).toBe(false);
    const folder = join(directory, `${randomUUID()}-${actor.workspaceId}`); await mkdir(folder);
    await writeFile(join(folder, "state.json"), JSON.stringify({ targetWorkspaceId: actor.workspaceId }));
    expect(await actual.productionSyncAllowed(actor.workspaceId, directory)).toBe(true);
    expect(await actual.productionSyncAllowed(randomUUID(), directory)).toBe(false);
    vi.stubEnv("VERCEL_ENV", "production"); expect(await actual.productionSyncAllowed(actor.workspaceId, directory)).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
