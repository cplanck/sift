import { requestActor } from "@/lib/auth";
import { env } from "@/lib/env";
import { apiError, json } from "@/lib/http";

export async function GET(request: Request) {
  try {
    await requestActor(request);
    const config = env();
    const publicCallback = new URL(config.ELEVENLABS_CALLBACK_ORIGIN ?? config.BETTER_AUTH_URL).protocol === "https:";
    const configured = publicCallback && !!(config.ELEVENLABS_API_KEY && config.ELEVENLABS_AGENT_ID && config.ELEVENLABS_LLM_SECRET && config.ELEVENLABS_WEBHOOK_SECRET);
    return json({ configured, ...(!configured ? { message: !publicCallback && config.ELEVENLABS_AGENT_ID
      ? "Voice needs a public HTTPS connection. Use the deployed Sift app, or configure a development tunnel."
      : "Voice isn’t configured yet. You can keep talking to Sift in text." } : {}) });
  } catch (error) { return apiError(error); }
}
