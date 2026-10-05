import { database } from "@/db";
import { json } from "@/lib/http";
import { recordVoiceUsage } from "@/services/voice";
import { verifyElevenWebhook } from "@/voice/elevenlabs";
import { readVoiceWebhook, voiceApiError } from "@/voice/http";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const usage = await verifyElevenWebhook(await readVoiceWebhook(request), request.headers.get("elevenlabs-signature") ?? "");
    if (usage) await recordVoiceUsage(database(), usage);
    return json({ received: true });
  } catch (error) { return voiceApiError(error); }
}
