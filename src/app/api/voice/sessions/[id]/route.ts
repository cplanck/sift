import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { assertSameOrigin, json, readJson } from "@/lib/http";
import { endVoiceSession, updateVoiceSession } from "@/services/voice";
import { voiceApiError } from "@/voice/http";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    return json(await updateVoiceSession(database(), await requestActor(request), (await params).id, await readJson(request, 8000)));
  } catch (error) { return voiceApiError(error); }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    return json(await endVoiceSession(database(), await requestActor(request), (await params).id));
  } catch (error) { return voiceApiError(error); }
}
