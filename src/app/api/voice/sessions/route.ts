import { database } from "@/db";
import { DomainError } from "@/domain/errors";
import { auth, requestActor } from "@/lib/auth";
import { requireConfig } from "@/lib/env";
import { assertSameOrigin, json, readJson } from "@/lib/http";
import { startVoiceSession } from "@/services/voice";
import { voiceApiError } from "@/voice/http";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request);
    const session = await auth().api.getSession({ headers: request.headers });
    if (!session || session.user.id !== actor.userId) throw new DomainError("UNAUTHENTICATED", "Please sign in again before starting voice.");
    requireConfig(["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "ELEVENLABS_LLM_SECRET", "ELEVENLABS_WEBHOOK_SECRET"]);
    return json(await startVoiceSession(database(), actor, session.session.id, await readJson(request, 8000)), 201);
  } catch (error) { return voiceApiError(error); }
}
