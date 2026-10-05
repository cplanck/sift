import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIMessageChunk } from "ai";
import { createVoiceStreamResponse, type VoiceStreamResult } from "@/ai/voice-stream";

function speech(raw: string) {
  return raw.split("\n").filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)).choices[0].delta.content ?? "").join("");
}
function pendingReply() {
  let source!: ReadableStreamDefaultController<UIMessageChunk>;
  const completed: VoiceStreamResult[] = [];
  const response = createVoiceStreamResponse({ responseId: "delayed-voice", getOutcome: () => "completed",
    stream: new ReadableStream({ start(controller) { source = controller; } }),
    onEnd: async (result) => { completed.push(result); },
  });
  return { source, completed, response };
}
afterEach(() => vi.useRealTimers());

describe("voice speech streaming", () => {
  it("waits without audible filler and streams actual text before the turn completes", async () => {
    vi.useFakeTimers();
    const { source, completed, response } = pendingReply();
    const reader = response.body!.getReader(), decoder = new TextDecoder();
    let raw = decoder.decode((await reader.read()).value);
    let receivedSpeech = false;
    const nextChunk = reader.read().then((value) => { receivedSpeech = true; return value; });
    await vi.advanceTimersByTimeAsync(5000);
    expect(receivedSpeech).toBe(false);
    source.enqueue({ type: "text-delta", id: "reply", delta: "The recipe is saved." });
    raw += decoder.decode((await nextChunk).value);
    expect(speech(raw)).toBe("The recipe is saved.");
    expect(completed).toEqual([]);
    source.close();
    while (true) { const next = await reader.read(); if (next.done) break; raw += decoder.decode(next.value); }
    expect(speech(raw)).toBe("The recipe is saved.");
    expect(completed).toEqual([{ text: speech(raw), outcome: "completed", requiresApproval: false }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves token fragments within one text part without adding separators", async () => {
    vi.useFakeTimers();
    const { source, response } = pendingReply(), result = response.text();
    source.enqueue({ type: "text-delta", id: "reply", delta: "Check the rec" });
    await vi.advanceTimersByTimeAsync(3000);
    source.enqueue({ type: "text-delta", id: "reply", delta: "ipe." }); source.close();
    expect(speech(await result)).toBe("Check the recipe.");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["text-part", "step"] as const)("separates sentences across a new %s", async (boundary) => {
    const { source, completed, response } = pendingReply(), result = response.text();
    source.enqueue({ type: "text-delta", id: "first", delta: "I found your recipe." });
    if (boundary === "step") source.enqueue({ type: "finish-step" });
    source.enqueue({ type: "text-delta", id: boundary === "text-part" ? "second" : "first", delta: "It serves four." });
    source.close();
    expect(speech(await result)).toBe("I found your recipe.\n\nIt serves four.");
    expect(completed[0].text).toBe("I found your recipe.\n\nIt serves four.");
  });

  it("provides a truthful fallback after tools-only completion without claiming a mutation succeeded", async () => {
    const { source, completed, response } = pendingReply(), result = response.text();
    source.enqueue({ type: "tool-output-available", toolCallId: "lookup", output: { ok: true, recipes: [] } });
    source.close();
    const text = speech(await result);
    expect(text).toBe("The reply finished without a spoken summary. Check the conversation for details.");
    expect(completed).toEqual([{ text, outcome: "completed", requiresApproval: false }]);
  });

  it.each(["error", "abort", "tool-approval-request"] as const)("retains the %s explanation without filler or a success fallback", async (type) => {
    vi.useFakeTimers();
    const { source, response } = pendingReply(), result = response.text();
    const part: UIMessageChunk = type === "error" ? { type, errorText: "safe failure" }
      : type === "abort" ? { type } : { type, approvalId: "approval", toolCallId: "tool" };
    source.enqueue(part);
    await vi.advanceTimersByTimeAsync(3000); source.close();
    const text = speech(await result);
    expect(text).toBe(type === "error" ? "Sift couldn’t finish that response. Open the conversation to review your saved changes before trying again."
      : type === "abort" ? "I stopped that reply. Some changes may already be saved; check the conversation."
        : "Please approve or decline that action using the confirmation in Sift.");
    expect(vi.getTimerCount()).toBe(0);
  });
});
