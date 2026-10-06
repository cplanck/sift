import { z } from "zod";
import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { resumeRecipeCover, cancelRecipeCover, getRecipeCoverState, requestRecipeCover } from "@/services/cover-generation";
import { dispatchCoverRequests } from "@/jobs/generate-cover";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return json(await getRecipeCoverState(database(), await requestActor(request), (await params).id)); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const result = await requestRecipeCover(database(), await requestActor(request), (await params).id, await readJson(request));
    // The committed request survives dispatch failure; the outbox job picks it up.
    await dispatchCoverRequests().catch(() => {});
    return json(result, 202);
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { requestId } = z.object({ requestId: z.uuid() }).parse(await readJson(request));
    return json(await cancelRecipeCover(database(), await requestActor(request), (await params).id, requestId));
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { requestId } = z.object({ requestId: z.uuid() }).parse(await readJson(request));
    const result = await resumeRecipeCover(database(), await requestActor(request), (await params).id, requestId);
    await dispatchCoverRequests().catch(() => {});
    return json(result, 202);
  } catch (error) { return apiError(error); }
}
