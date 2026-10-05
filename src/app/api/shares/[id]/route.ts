import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json } from "@/lib/http";
import { revokeRecipeShare } from "@/services/shares";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    return json(await revokeRecipeShare(database(), await requestActor(request), (await params).id));
  } catch (error) { return apiError(error); }
}
