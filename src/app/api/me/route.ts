import { requestActor } from "@/lib/auth";
import { apiError, json } from "@/lib/http";
import { getWorkspace } from "@/services/workspaces";
import { database } from "@/db";
export async function GET(request: Request) {
  try {
    const viewer = await requestActor(request);
    return json({ ...viewer, workspace: await getWorkspace(database(), viewer) });
  } catch (error) { return apiError(error); }
}
