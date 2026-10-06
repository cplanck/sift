import "server-only";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export function localDevelopmentSyncEnabled() {
  if (process.env.VERCEL === "1" || (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "development")) return false;
  try {
    const local = (value: string) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
    return local(process.env.BETTER_AUTH_URL ?? "") && local(process.env.DATABASE_URL ?? "");
  } catch { return false; }
}

// A prior CLI sync authorizes this personal workspace. A newly registered
// local account cannot use the cached production connection to claim data.
export async function productionSyncAllowed(workspaceId: string, directory = join(process.cwd(), ".local/production-sync")) {
  if (!localDevelopmentSyncEnabled() || !/^[a-f\d-]{36}$/i.test(workspaceId)) return false;
  try {
    const folders = await readdir(directory);
    for (const folder of folders.filter((name) => /^[a-f\d-]{73}$/i.test(name) && name.endsWith(`-${workspaceId}`))) {
      const state = JSON.parse(await readFile(join(directory, folder, "state.json"), "utf8"));
      if (state.targetWorkspaceId === workspaceId) return true;
    }
  } catch { /* Missing local setup simply hides the development control. */ }
  return false;
}
