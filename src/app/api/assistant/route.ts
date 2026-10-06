import { after } from "next/server";
import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { assistantResponse } from "@/ai/assistant-runtime";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request);
    return await assistantResponse(database(), actor, await readJson(request), { waitUntil: (task) => after(() => task) });
  } catch (error) { return apiError(error); }
}
