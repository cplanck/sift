import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { z } from "zod";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { localDevelopmentSyncEnabled, productionSyncAllowed } from "@/lib/dev-production-sync";
import { productionSyncResultSchema } from "@/domain/production-sync";
import { DomainError } from "@/domain/errors";

export const runtime = "nodejs";
const execute = promisify(execFile);
const running = new Set<string>();
export async function POST(request: Request) {
  if (!localDevelopmentSyncEnabled()) return json({ error: "Not found." }, 404);
  let workspaceId: string | undefined;
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request);
    if (!await productionSyncAllowed(actor.workspaceId)) return json({ error: "Not found." }, 404);
    const { apply } = z.object({ apply: z.boolean().default(false) }).strict().parse(await readJson(request, 1024));
    if (running.has(actor.workspaceId)) throw new DomainError("CONFLICT", "A production sync is already running. Try again shortly.");
    workspaceId = actor.workspaceId; running.add(workspaceId);
    const args = [join(process.cwd(), "scripts/sync-production.mjs"), "--json", "--email", actor.email, "--local-email", actor.email];
    if (apply) args.push("--apply");
    try {
      const { stdout } = await execute(process.execPath, args, { cwd: process.cwd(), timeout: 120000, maxBuffer: 512 * 1024 });
      return json(productionSyncResultSchema.parse(JSON.parse(stdout.trim())));
    } catch {
      return json({ error: "Couldn’t sync from production. Check the saved production connection and try again.", code: "SYNC_FAILED" }, 502);
    }
  } catch (error) { return apiError(error); }
  finally { if (workspaceId) running.delete(workspaceId); }
}
