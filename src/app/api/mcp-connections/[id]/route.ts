import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json } from "@/lib/http";
import { revokeMcpConnection } from "@/services/mcp-connections";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    await revokeMcpConnection(database(), await requestActor(request), (await params).id);
    return json({ revoked: true });
  } catch (error) { return apiError(error); }
}
