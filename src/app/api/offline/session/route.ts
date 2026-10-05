import { requestActor } from "@/lib/auth";
import { apiError, json } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const { userId, workspaceId, sessionExpiresAt } = await requestActor(request);
    return json({ userId, workspaceId, sessionExpiresAt });
  } catch (error) { return apiError(error); }
}
