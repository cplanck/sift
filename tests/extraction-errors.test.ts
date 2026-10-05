import { beforeEach, describe, expect, it, vi } from "vitest";
import { APICallError, RetryError } from "ai";
import { GatewayInternalServerError } from "@ai-sdk/gateway";
import type { Database } from "@/db/connection";
import { DomainError } from "@/domain/errors";
import { extractionError, extractRecipe } from "@/ai/extract-recipe";

const { generate, credential, recordUsage, model } = vi.hoisted(() => ({ generate: vi.fn(), credential: vi.fn(), recordUsage: vi.fn(), model: vi.fn() }));
vi.mock("ai", async (importOriginal) => ({ ...await importOriginal<typeof import("ai")>(), generateText: generate }));
vi.mock("@/ai/models", () => ({ gatewayModel: model }));
vi.mock("@/services/credentials", () => ({ resolveGatewayCredential: credential }));
vi.mock("@/services/ai-usage", () => ({ recordModelUsage: recordUsage }));

const sensitive = "private-source-and-credential-marker";
const providerError = (statusCode: number) => new APICallError({ message: sensitive, url: "https://provider.example", requestBodyValues: { private: sensitive }, responseBody: sensitive, statusCode });
const context = { db: {} as Database, actor: { userId: "e8c108cc-8469-4f70-ad5e-611c29c8ba3a", workspaceId: "2c713ffc-2695-4f56-8f81-92b6e6765b2f" }, importId: "fd5a36f6-2a3d-435f-b868-638c18050bac" };
beforeEach(() => {
  generate.mockReset(); credential.mockReset(); recordUsage.mockReset(); model.mockReset();
  credential.mockResolvedValue(undefined); recordUsage.mockResolvedValue(undefined); model.mockReturnValue({ modelId: "anthropic/test-extraction" });
});

describe("safe extraction failure handling", () => {
  it.each([400, 401, 402, 403, 404, 422])("turns permanent HTTP %i failures into a safe terminal import error", (status) => {
    const error = extractionError(providerError(status));
    expect(error).toBeInstanceOf(DomainError);
    expect(error?.code).toBe("INVALID_INPUT");
    expect(error?.message).not.toContain(sensitive);
    expect(JSON.stringify(error)).not.toContain(sensitive);
    expect(error?.cause).toBeUndefined();
  });

  it("uses the status even when Gateway wraps a credit failure as an internal-server error", () => {
    const error = new GatewayInternalServerError({ message: sensitive, statusCode: 403, cause: providerError(403) });
    expect(extractionError(error)?.message).toMatch(/billing, credits, and model access/);
    const retried = new RetryError({ message: sensitive, reason: "errorNotRetryable", errors: [error] });
    expect(extractionError(retried)?.message).toBe(extractionError(error)?.message);
  });

  it("explains the paid-credit requirement without exposing the nested provider response", () => {
    const cause = new APICallError({ message: sensitive, url: "https://provider.example", requestBodyValues: {}, statusCode: 403,
      responseBody: JSON.stringify({ error: { message: `Free tier users do not have access to this model. Upgrade to paid credits for unrestricted access. ${sensitive}` } }),
    });
    const error = new GatewayInternalServerError({ message: sensitive, statusCode: 403, cause });
    const result = extractionError(error);
    expect(result?.message).toContain("Purchase credits");
    expect(result?.message).toContain("Adding a payment method alone");
    expect(result?.message).not.toContain(sensitive);
    expect(result?.cause).toBeUndefined();
  });

  it("preserves transient failures for the durable retry path and ignores unrelated errors", () => {
    for (const status of [408, 429, 500, 502, 503]) expect(extractionError(providerError(status))).toBeNull();
    expect(extractionError(new Error(sensitive))).toBeNull();
    expect(extractionError({ statusCode: 403, message: sensitive })).toBeNull();
  });

  it("throws the safe terminal error from extraction, without retaining the provider exception", async () => {
    generate.mockRejectedValue(new GatewayInternalServerError({ message: sensitive, statusCode: 403 }));
    await expect(extractRecipe({ text: "Harmless soup recipe." }, context)).rejects.toMatchObject({ name: "DomainError", code: "INVALID_INPUT" });
    expect(generate).toHaveBeenCalledOnce();
  });

  it("uses the user's credential and records each attempt with an unknown start and reported finish", async () => {
    credential.mockResolvedValue(sensitive);
    const usage = { inputTokens: 100, outputTokens: 40, totalTokens: 140 };
    const providerMetadata = { gateway: { cost: "0.00042", generationId: "gen_test" } };
    generate.mockImplementation(async (options) => {
      await options.onLanguageModelCallStart({ callId: "provider-call", modelId: "anthropic/test-extraction" });
      await options.onLanguageModelCallEnd({ callId: "provider-call", modelId: "anthropic/test-extraction", usage, providerMetadata });
      return { output: { title: "Soup", ingredientSections: [{ items: [{ text: "2 cups broth" }] }], instructionSections: [{ steps: ["Heat broth."] }] } };
    });
    await extractRecipe({ text: "Harmless soup recipe." }, context);
    expect(credential).toHaveBeenCalledWith(context.db, context.actor.userId);
    expect(model).toHaveBeenCalledWith("extraction", sensitive);
    expect(generate.mock.calls[0][0]).toMatchObject({ maxRetries: 0, providerOptions: { gateway: { user: context.actor.userId, tags: ["sift", "import"] } } });
    const start = recordUsage.mock.calls[0][2], end = recordUsage.mock.calls[1][2];
    expect(start).toMatchObject({ importId: context.importId, credentialSource: "user", model: "anthropic/test-extraction" });
    expect(start.usage).toBeUndefined();
    expect(start.providerMetadata).toBeUndefined();
    expect(end).toMatchObject({ idempotencyKey: start.idempotencyKey, usage, providerMetadata });
    expect(JSON.stringify(recordUsage.mock.calls)).not.toContain(sensitive);
    await extractRecipe({ text: "Harmless soup recipe." }, context);
    expect(recordUsage.mock.calls[2][2].idempotencyKey).not.toBe(start.idempotencyKey);
  });

  it("keeps a failed app-credential attempt unpriced rather than recording a false zero cost", async () => {
    generate.mockImplementation(async (options) => {
      await options.onLanguageModelCallStart({ callId: "rejected-call", modelId: "anthropic/test-extraction" });
      throw new GatewayInternalServerError({ message: sensitive, statusCode: 403 });
    });
    await expect(extractRecipe({ text: "Harmless soup recipe." }, context)).rejects.toBeInstanceOf(DomainError);
    expect(model).toHaveBeenCalledWith("extraction", undefined);
    expect(recordUsage).toHaveBeenCalledOnce();
    expect(recordUsage.mock.calls[0][2]).toMatchObject({ credentialSource: "app" });
    expect(recordUsage.mock.calls[0][2].usage).toBeUndefined();
    expect(recordUsage.mock.calls[0][2].providerMetadata).toBeUndefined();
  });
});
