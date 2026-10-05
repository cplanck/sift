import { after } from "next/server";
import { database } from "@/db";
import { readJson } from "@/lib/http";
import { respondToVoice } from "@/services/voice";
import { assertVoiceCallback, voiceApiError } from "@/voice/http";
export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(request: Request) {
  try {
    assertVoiceCallback(request);
    return await respondToVoice(database(), request.headers.get("x-sift-voice-conversation") ?? "", request.headers.get("x-sift-voice-turn"), await readJson(request), {
      abortSignal: request.signal, waitUntil: (task) => after(() => task),
    });
  } catch (error) { return voiceApiError(error); }
}
