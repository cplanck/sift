import "server-only";
import { randomUUID } from "node:crypto";
import { createAgentUIStreamResponse, isStepCount, isToolUIPart, ToolLoopAgent, type InferUITools, type LanguageModel, type UIDataTypes, type UIMessage } from "ai";
import type { Database } from "@/db/connection";
import { assistantRequestSchema } from "@/domain/assistant";
import { DomainError } from "@/domain/errors";
import { beginConversationTurn, finishConversationTurn, assertConversationRun, getConversation } from "@/services/conversations";
import { resolveGatewayCredential } from "@/services/credentials";
import { recordModelUsage } from "@/services/ai-usage";
import { consumeLimit } from "@/services/rate-limit";
import { getRecipe } from "@/services/recipes";
import { getCookingSession } from "@/services/cooking";
import type { Actor } from "@/services/workspaces";
import { assistantInstructions, resolveAssistantContext } from "./context";
import { prepareAssistantModel } from "./models";
import { providerErrorMessage } from "./provider-errors";
import { createRecipeTools, safeAssistantError, type RecipeTools } from "./recipe-tools";

export type SiftUIMessage = UIMessage<unknown, UIDataTypes, InferUITools<RecipeTools>>;
const failedResponse = "Sift couldn’t finish that response. Reload the conversation and check your recipe before trying again.";
const toolNames: (keyof RecipeTools)[] = ["searchRecipes", "getRecipe", "createRecipe", "updateRecipe", "archiveRecipe", "restoreArchivedRecipe", "restoreRecipeVersion", "listRecipeVersions", "listRecipeNotes", "addRecipeNote", "setRecipeFavorite", "startCookingSession", "getCookingSession", "updateCookingProgress", "finishCookingSession", "abandonCookingSession", "addCookingSessionNote", "listCookingHistory"];
const discoveryTools: (keyof RecipeTools)[] = ["searchRecipes", "getRecipe", "createRecipe"];

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

export async function assistantResponse(db: Database, actor: Actor, input: unknown, options: {
  /** Dependency injection for provider-boundary tests; never read from HTTP input. */
  model?: LanguageModel;
  /** Route handlers register this promise with Next's after lifecycle. */
  waitUntil?: (task: Promise<void>) => void;
} = {}): Promise<Response> {
  const request = assistantRequestSchema.parse(input);
  const page = await resolveAssistantContext(db, actor, request.context);
  await getConversation(db, actor, request.conversationId);
  const userKey = await resolveGatewayCredential(db, actor.userId);
  const chooseModel = options.model ? undefined : prepareAssistantModel(userKey);
  await consumeLimit(db, actor, "assistant", 60);
  const run = await beginConversationTurn(db, actor, request);
  const model = options.model ?? chooseModel!(run.modelId);
  const trustedMessages = settledMessages(run.messages, "approval" in request ? request.approval.id : undefined);
  const tools = createRecipeTools(db, actor, { conversationId: request.conversationId, runId: run.runId });
  let approvalIssued = false;
  let settled = false;
  let settlement: Promise<void> | undefined;
  let latestMessages = trustedMessages;
  let errorMessage = failedResponse;
  let modelCallNumber = 0;
  let sawStreamError = false;

  function observeError(error: unknown) {
    sawStreamError = true;
    const message = responseError(error);
    if (message !== failedResponse || errorMessage === failedResponse) errorMessage = message;
    return errorMessage;
  }

  async function settle(messages: UIMessage[], outcome: "completed" | "failed" | "aborted") {
    if (settled) return;
    if (settlement) return settlement;
    settlement = finishConversationTurn(db, actor, request.conversationId, run.runId, settledMessages(messages), outcome, outcome === "completed" ? undefined : errorMessage).then(() => { settled = true; });
    try { await settlement; }
    finally { settlement = undefined; }
  }

  const agent = new ToolLoopAgent({
    model, instructions: assistantInstructions(page), tools,
    stopWhen: isStepCount(8), maxOutputTokens: 6000, maxRetries: 0,
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
    prepareStep: ({ steps }) => ({
      activeTools: page.recipe || steps.some((step) => step.toolResults.some((result) => (result.toolName === "getRecipe" || result.toolName === "createRecipe") && !!result.output && typeof result.output === "object" && "ok" in result.output && result.output.ok === true)) ? toolNames : discoveryTools,
    }),
    toolApproval: {
      archiveRecipe: async ({ recipeId, expectedVersionId }) => {
        if (approvalIssued) return { type: "denied", reason: "Confirm the pending action before proposing another action that needs approval." };
        approvalIssued = true;
        try {
          await assertConversationRun(db, actor, request.conversationId, run.runId);
          const recipe = await getRecipe(db, actor, recipeId);
          if (recipe.version.id !== expectedVersionId) throw new DomainError("CONFLICT", "The recipe changed. Read its current version before proposing an archive.");
          if (recipe.status !== "active") throw new DomainError("INVALID_INPUT", "Only an approved, active recipe can be archived.");
          return { type: "user-approval", reason: `Archive “${recipe.version.content.title}” from your Library? You can restore it later.` };
        } catch (error) { return { type: "denied", reason: safeAssistantError(error).error }; }
      },
      abandonCookingSession: async ({ sessionId, expectedRevision }) => {
        if (approvalIssued) return { type: "denied", reason: "Confirm the pending action before proposing another action that needs approval." };
        approvalIssued = true;
        try {
          await assertConversationRun(db, actor, request.conversationId, run.runId);
          const session = await getCookingSession(db, actor, sessionId);
          if (session.startedByUserId !== actor.userId) throw new DomainError("NOT_FOUND", "Cooking session not found.");
          if (session.revision !== expectedRevision) throw new DomainError("CONFLICT", "This cook changed. Read its saved progress before proposing to end it.");
          if (session.status !== "active") throw new DomainError("INVALID_INPUT", "Only an active cook can be ended.");
          return { type: "user-approval", reason: `End your cook of “${session.version.content.title}” without marking it completed? Your notes and history will be kept.` };
        } catch (error) { return { type: "denied", reason: safeAssistantError(error).error }; }
      },
    },
  });

  try {
    return await createAgentUIStreamResponse({
      agent, uiMessages: trustedMessages, generateMessageId: randomUUID,
      timeout: 60000, sendReasoning: false,
      headers: { "Cache-Control": "private, no-store", "X-Conversation-Id": request.conversationId, "X-Assistant-Run-Id": run.runId },
      onError: observeError,
      onEnd: async ({ messages, outcome, isAborted }) => {
        latestMessages = messages;
        await settle(messages, isAborted || outcome.status === "aborted" ? "aborted" : !sawStreamError && outcome.status === "completed" ? "completed" : "failed");
      },
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
    await settle(latestMessages, "failed");
    if (error instanceof DomainError) throw error;
    throw new DomainError("INVALID_INPUT", errorMessage);
  }
}
