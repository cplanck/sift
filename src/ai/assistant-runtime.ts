import "server-only";
import { randomUUID } from "node:crypto";
import { createAgentUIStream, createUIMessageStreamResponse, isStepCount, isToolUIPart, smoothStream, ToolLoopAgent, type InferUITools, type LanguageModel, type UIDataTypes, type UIMessage } from "ai";
import type { Database } from "@/db/connection";
import { assistantRequestSchema } from "@/domain/assistant";
import { DomainError } from "@/domain/errors";
import type { RecipeContent } from "@/domain/recipe";
import { beginConversationTurn, finishConversationTurn, assertConversationRun, getConversation, type StartedConversationTurn } from "@/services/conversations";
import { resolveGatewayCredential } from "@/services/credentials";
import { recordModelUsage } from "@/services/ai-usage";
import { consumeLimit } from "@/services/rate-limit";
import { getRecipe } from "@/services/recipes";
import { getCookingSession } from "@/services/cooking";
import { getArtifact } from "@/services/artifacts";
import { assertChatPhoto } from "@/services/photos";
import { readPhotoObject } from "@/lib/r2";
import type { Actor } from "@/services/workspaces";
import { assistantInstructions, resolveAssistantContext } from "./context";
import { prepareAssistantModel } from "./models";
import { providerErrorMessage } from "./provider-errors";
import { createRecipeTools, safeAssistantError, type RecipeTools } from "./recipe-tools";
import { createVoiceStreamResponse, type VoiceStreamResult, type VoiceStreamOutcome } from "./voice-stream";

export type SiftUIMessage = UIMessage<unknown, UIDataTypes, InferUITools<RecipeTools>>;
const failedResponse = "Sift couldn’t finish that response. Reload the conversation and review your saved changes before trying again.";
const artifactTools: (keyof RecipeTools)[] = ["listArtifacts", "getArtifact", "createGroceryList", "deriveGroceryList", "addGroceryItems", "removeGroceryItem", "setGroceryItemChecked", "addShoppingRecipe", "removeShoppingRecipe", "updateShoppingRecipe", "updateGroceryItem", "categorizeGroceryItems", "setShoppingListArchived", "clearCheckedGroceryItems", "renameArtifact", "deleteArtifact"];
// Available on every page. None of these overwrite canonical recipe content
// from a stale read: batch labels re-read each recipe inside their transaction.
const appTools: (keyof RecipeTools)[] = ["webSearch", "readWebPage", "importRecipe", "listImports", "getImportDraft", "approveImportDraft", "navigate", "findActiveCooks", "tagRecipes", "setRecipeFavorites", "scaleRecipe", "listRecipePhotos", "setRecipeCoverPhoto", "generateRecipeCover", "getRecipeCoverStatus", "removeRecipeCover", "addPhotoToRecipe", "addPhotoToCook", "createShareLink", "listShareLinks", "revokeShareLink", "getAiUsage"];
const toolNames: (keyof RecipeTools)[] = ["searchRecipes", "getRecipe", "createRecipe", "updateRecipe", "archiveRecipe", "restoreArchivedRecipe", "restoreRecipeVersion", "listRecipeVersions", "listRecipeNotes", "addRecipeNote", "setRecipeFavorite", "startCookingSession", "getCookingSession", "updateCookingProgress", "finishCookingSession", "abandonCookingSession", "addCookingSessionNote", "listCookingHistory", ...artifactTools, ...appTools];
const discoveryTools: (keyof RecipeTools)[] = ["searchRecipes", "getRecipe", "createRecipe", ...artifactTools, ...appTools];

function responseError(error: unknown) {
  return providerErrorMessage(error) ?? failedResponse;
}

function settledMessages(messages: UIMessage[], currentApprovalId?: string): UIMessage[] {
  // Partial tool inputs have no trustworthy result and cannot be replayed as a
  // completed assistant action. The service journal separately retains commits.
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (isToolUIPart(part) && part.state === "approval-responded" && part.approval.id !== currentApprovalId) {
        return part.approval.approved
          ? { ...part, state: "output-error" as const, approval: { ...part.approval, approved: true as const }, errorText: "This action was interrupted. Check the saved changes before requesting it again." }
          : { ...part, state: "output-denied" as const, approval: { ...part.approval, approved: false as const } };
      }
      return part;
    }).filter((part) => !isToolUIPart(part) || (part.state !== "input-streaming" && part.state !== "input-available")),
  })).filter((message) => message.parts.some((part) => part.type !== "step-start"));
}

export type AssistantRuntimeOptions = {
  /** Dependency injection for provider-boundary tests; never read from HTTP input. */
  model?: LanguageModel;
  /** Route handlers register this promise with Next's after lifecycle. */
  waitUntil?: (task: Promise<void>) => void;
  abortSignal?: AbortSignal;
  /** Trusted server lifecycle hook; wraps the shared begin in a voice transaction. */
  beginTurn?: (begin: (tx: Database) => Promise<StartedConversationTurn>) => Promise<StartedConversationTurn | Response>;
  /** Recheck a durable voice session/turn before each billed model call. */
  assertActive?: (runId: string) => Promise<void>;
};
export type AssistantVoiceOptions = AssistantRuntimeOptions & {
  onVoiceEnd?: (result: VoiceStreamResult & { runId: string; requestId: string }) => Promise<void>;
};

export function assistantResponse(db: Database, actor: Actor, input: unknown, options: AssistantRuntimeOptions = {}): Promise<Response> {
  return runAssistantResponse(db, actor, input, options, "text");
}
export function assistantVoiceResponse(db: Database, actor: Actor, input: unknown, options: AssistantVoiceOptions = {}): Promise<Response> {
  return runAssistantResponse(db, actor, input, options, "voice");
}

const photoUrl = /^\/api\/photos\/([0-9a-f-]{36})$/i;
/**
 * Saved messages reference chat photos by URL. The model needs the bytes:
 * the two most recent user messages carry their photos as images, and older
 * photos become short references so long chats don't resend every image.
 * Photo IDs are spelled out so tools can attach a photo to a recipe or cook.
 */
async function withPhotoData(db: Database, actor: Actor, messages: UIMessage[]) {
  const userIndexes = messages.flatMap((message, index) => message.role === "user" ? [index] : []);
  const recent = new Set(userIndexes.slice(-2));
  const originals = new Map<string, UIMessage>();
  const result: UIMessage[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.role !== "user" || !message.parts.some((part) => part.type === "file")) { result.push(message); continue; }
    const parts: UIMessage["parts"] = [];
    for (const part of message.parts) {
      if (part.type !== "file") { parts.push(part); continue; }
      const id = part.url.match(photoUrl)?.[1];
      if (!id) continue;
      if (!recent.has(index)) { parts.push({ type: "text", text: `[Earlier photo, id ${id}]` }); continue; }
      try {
        const photo = await assertChatPhoto(db, actor, id);
        const bytes = await readPhotoObject(photo.objectKey);
        parts.push({ ...part, url: `data:image/webp;base64,${Buffer.from(bytes).toString("base64")}` }, { type: "text", text: `[Attached photo id: ${id}]` });
      } catch { parts.push({ type: "text", text: `[Photo ${id} is no longer available]` }); }
    }
    originals.set(message.id, message);
    result.push({ ...message, parts });
  }
  return { messages: result, originals };
}

async function runAssistantResponse(db: Database, actor: Actor, input: unknown, options: AssistantVoiceOptions, transport: "text" | "voice"): Promise<Response> {
  const request = assistantRequestSchema.parse(input);
  const page = await resolveAssistantContext(db, actor, request.context);
  await getConversation(db, actor, request.conversationId);
  const userKey = await resolveGatewayCredential(db, actor.userId);
  const chooseModel = options.model ? undefined : prepareAssistantModel(userKey);
  options.abortSignal?.throwIfAborted();
  // Charge admission only after validation, in the same transaction as the
  // durable turn. Provider retries and rejected/stale requests must not consume
  // a user's allowance, and an exhausted allowance must leave no reserved run.
  const begin = (connection: Database) => connection.transaction(async (tx) => {
    const run = await beginConversationTurn(tx, actor, request);
    await consumeLimit(tx, actor, "assistant", 60);
    options.abortSignal?.throwIfAborted();
    return run;
  });
  const started = options.beginTurn ? await options.beginTurn(begin) : await begin(db);
  // A trusted transport can settle a duplicate or a review-only notice without
  // starting another model call. HTTP input cannot supply this lifecycle hook.
  if (started instanceof Response) return started;
  const run = started;
  let approvalIssued = false;
  let settled = false;
  let settlement: Promise<void> | undefined;
  let latestMessages = run.messages;
  // Model-only copies of user messages carrying photo bytes; never persisted.
  let photoOriginals = new Map<string, UIMessage>();
  let errorMessage = failedResponse;
  let modelCallNumber = 0;
  let sawStreamError = false;
  let finalOutcome: VoiceStreamOutcome = "failed";

  function observeError(error: unknown) {
    sawStreamError = true;
    const message = responseError(error);
    if (message !== failedResponse || errorMessage === failedResponse) errorMessage = message;
    return errorMessage;
  }

  async function settle(messages: UIMessage[], outcome: "completed" | "failed" | "aborted") {
    if (settled) return;
    if (settlement) return settlement;
    const persisted = messages.map((message) => photoOriginals.get(message.id) ?? message);
    settlement = finishConversationTurn(db, actor, request.conversationId, run.runId, settledMessages(persisted), outcome, outcome === "completed" ? undefined : errorMessage).then(() => { settled = true; });
    try { await settlement; }
    finally { settlement = undefined; }
  }

  try {
    const model = options.model ?? chooseModel!(run.modelId);
    const trustedMessages = settledMessages(run.messages, "approval" in request ? request.approval.id : undefined);
    latestMessages = trustedMessages;
    const withPhotos = await withPhotoData(db, actor, trustedMessages);
    photoOriginals = withPhotos.originals;
    const tools = createRecipeTools(db, actor, { conversationId: request.conversationId, runId: run.runId,
      ...(options.assertActive ? { assertActive: () => options.assertActive!(run.runId) } : {}),
    });
    const agent = new ToolLoopAgent({
    model, instructions: [assistantInstructions(page), ...(transport === "voice" ? ["This reply is spoken through Sift voice. Use short, natural sentences and plain text. Answer directly without 'one moment', 'just a moment', or repeated offers of further help. Do not read raw JSON, IDs, tool arguments, or Markdown formatting aloud. Speech can be misheard: naming a dish or discussing an idea is not permission to save it. New recipes require on-screen confirmation before saving. If native approval is needed, ask the user to use the on-screen confirmation; spoken agreement does not approve an action."] : [])].join("\n\n"), tools,
    // Enough steps for bulk work (tagging a cookbook, building a week of plans).
    stopWhen: isStepCount(30), maxOutputTokens: 6000, maxRetries: 0,
    allowSystemInMessages: false,
    // SDK 7 forwards prepared call options to streamText. Its default error
    // observer logs raw provider exceptions; replace it before the UI adapter.
    // Keep this covered by the provider-error/no-secret-logging regression.
    prepareCall: (settings) => ({ ...settings, onError: ({ error }: { error: unknown }) => { observeError(error); } }),
    providerOptions: { gateway: { user: actor.userId, tags: ["sift", "assistant"] } },
    onLanguageModelCallStart: async ({ modelId }) => {
      modelCallNumber++;
      await recordModelUsage(db, actor, { idempotencyKey: `${run.runId}:${modelCallNumber}`, conversationId: request.conversationId, runId: run.runId, model: modelId, credentialSource: userKey ? "user" : "app" });
    },
    onLanguageModelCallEnd: async ({ modelId, usage, providerMetadata }) => {
      await recordModelUsage(db, actor, { idempotencyKey: `${run.runId}:${modelCallNumber}`, conversationId: request.conversationId, runId: run.runId, model: modelId, credentialSource: userKey ? "user" : "app", usage, providerMetadata });
    },
    prepareStep: async ({ steps }) => {
      // SDK telemetry hooks deliberately swallow callback exceptions. This
      // awaited preparation hook enforces the fence before generation instead.
      await assertConversationRun(db, actor, request.conversationId, run.runId);
      await options.assertActive?.(run.runId);
      return { activeTools: page.recipe || steps.some((step) => step.toolResults.some((result) => (result.toolName === "getRecipe" || result.toolName === "createRecipe") && !!result.output && typeof result.output === "object" && "ok" in result.output && result.output.ok === true)) ? toolNames : discoveryTools };
    },
    toolApproval: {
      ...(transport === "voice" ? {
        createRecipe: async ({ content }: { content: RecipeContent }) => {
          if (approvalIssued) return { type: "denied" as const, reason: "Confirm the pending action before proposing another recipe." };
          approvalIssued = true;
          try {
            await assertConversationRun(db, actor, request.conversationId, run.runId);
            await options.assertActive?.(run.runId);
            return { type: "user-approval" as const, reason: `Save “${content.title}” to your cookbook?` };
          } catch (error) { return { type: "denied" as const, reason: safeAssistantError(error).error }; }
        },
      } : {}),
      archiveRecipe: async ({ recipeId, expectedVersionId }) => {
        if (approvalIssued) return { type: "denied", reason: "Confirm the pending action before proposing another action that needs approval." };
        approvalIssued = true;
        try {
          await assertConversationRun(db, actor, request.conversationId, run.runId);
          await options.assertActive?.(run.runId);
          const recipe = await getRecipe(db, actor, recipeId);
          if (recipe.version.id !== expectedVersionId) throw new DomainError("CONFLICT", "The recipe changed. Read its current version before proposing an archive.");
          if (recipe.status !== "active") throw new DomainError("INVALID_INPUT", "Only an approved, active recipe can be archived.");
          return { type: "user-approval", reason: `Archive “${recipe.version.content.title}” from your Library? You can restore it later.` };
        } catch (error) { return { type: "denied", reason: safeAssistantError(error).error }; }
      },
      deleteArtifact: async ({ artifactId, expectedRevision }) => {
        if (approvalIssued) return { type: "denied", reason: "Confirm the pending action before proposing another action that needs approval." };
        approvalIssued = true;
        try {
          await assertConversationRun(db, actor, request.conversationId, run.runId);
          await options.assertActive?.(run.runId);
          const artifact = await getArtifact(db, actor, artifactId);
          if (artifact.revision !== expectedRevision) throw new DomainError("CONFLICT", "This list or plan changed. Read it again before proposing to delete it.");
          return { type: "user-approval", reason: `Delete “${artifact.title}”? This can’t be undone.` };
        } catch (error) { return { type: "denied", reason: safeAssistantError(error).error }; }
      },
      revokeShareLink: async () => {
        if (approvalIssued) return { type: "denied", reason: "Confirm the pending action before proposing another action that needs approval." };
        approvalIssued = true;
        try {
          await assertConversationRun(db, actor, request.conversationId, run.runId);
          await options.assertActive?.(run.runId);
          return { type: "user-approval", reason: "Turn off this share link? Anyone using it will lose access." };
        } catch (error) { return { type: "denied", reason: safeAssistantError(error).error }; }
      },
      abandonCookingSession: async ({ sessionId, expectedRevision }) => {
        if (approvalIssued) return { type: "denied", reason: "Confirm the pending action before proposing another action that needs approval." };
        approvalIssued = true;
        try {
          await assertConversationRun(db, actor, request.conversationId, run.runId);
          await options.assertActive?.(run.runId);
          const session = await getCookingSession(db, actor, sessionId);
          if (session.startedByUserId !== actor.userId) throw new DomainError("NOT_FOUND", "Cooking session not found.");
          if (session.revision !== expectedRevision) throw new DomainError("CONFLICT", "This cook changed. Read its saved progress before proposing to end it.");
          if (session.status !== "active") throw new DomainError("INVALID_INPUT", "Only an active cook can be ended.");
          return { type: "user-approval", reason: `End your cook of “${session.version.content.title}” without marking it completed? Your notes and history will be kept.` };
        } catch (error) { return { type: "denied", reason: safeAssistantError(error).error }; }
      },
    },
  });

    const stream = await createAgentUIStream({
      agent, uiMessages: withPhotos.messages, generateMessageId: randomUUID,
      // Tool-heavy replies can run long overall; any single step stays bounded.
      timeout: { totalMs: 280_000, stepMs: 60_000 }, sendReasoning: false, abortSignal: options.abortSignal,
      // Release text word by word so bursty provider chunks read smoothly.
      // Speech is synthesized from whole phrases, so voice skips the delay.
      ...(transport === "voice" ? {} : { experimental_transform: smoothStream<typeof tools>({ delayInMs: 12, chunking: "word" }) }),
      onError: observeError,
      onEnd: async ({ messages, outcome, isAborted }) => {
        latestMessages = messages;
        finalOutcome = isAborted || options.abortSignal?.aborted || outcome.status === "aborted" ? "aborted" : !sawStreamError && outcome.status === "completed" ? "completed" : "failed";
        await settle(messages, finalOutcome);
      },
    });
    if (transport === "voice") return createVoiceStreamResponse({
      stream, responseId: `chatcmpl-${run.runId}`, getOutcome: () => finalOutcome, getErrorMessage: () => errorMessage,
      waitUntil: options.waitUntil,
      onEnd: async (result) => {
        // Normally the SDK already settled. A raw source-stream failure can
        // bypass its onEnd, so the adapter also closes the shared run here.
        try { await settle(latestMessages, result.outcome); }
        finally { await options.onVoiceEnd?.({ ...result, runId: run.runId, requestId: request.requestId }); }
      },
    });
    return createUIMessageStreamResponse({
      stream,
      headers: { "Cache-Control": "private, no-store", "X-Conversation-Id": request.conversationId, "X-Assistant-Run-Id": run.runId },
      consumeSseStream: ({ stream }) => {
        // Drain the SDK's own SSE stream independently of the browser. This is
        // lifecycle/persistence handling, not another agent or streaming loop.
        const completion = stream.pipeTo(new WritableStream({ write() {} })).catch(async () => {
          try { await settle(latestMessages, "failed"); }
          catch { console.error(JSON.stringify({ event: "assistant.persistence_failed", conversationId: request.conversationId, runId: run.runId })); }
        });
        options.waitUntil?.(completion);
      },
    });
  } catch (error) {
    observeError(error);
    try { await settle(latestMessages, "failed"); }
    finally {
      if (transport === "voice") await options.onVoiceEnd?.({ runId: run.runId, requestId: request.requestId, text: errorMessage, outcome: "failed", requiresApproval: false });
    }
    if (error instanceof DomainError) throw error;
    throw new DomainError("INVALID_INPUT", errorMessage);
  }
}
