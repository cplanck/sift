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

describe("voice response startup feedback", () => {
  it("streams one acknowledgement while the agent is still working and retains the exact spoken result", async () => {
    vi.useFakeTimers();
    const { source, completed, response } = pendingReply();
    const reader = response.body!.getReader(), decoder = new TextDecoder();
    let raw = decoder.decode((await reader.read()).value);
    await vi.advanceTimersByTimeAsync(1000);
    raw += decoder.decode((await reader.read()).value);
    expect(speech(raw)).toBe("One moment... "); // Delivered before the model has any text.
    await vi.advanceTimersByTimeAsync(4000);
    source.enqueue({ type: "text-delta", id: "reply", delta: "The recipe is saved." }); source.close();
    while (true) { const next = await reader.read(); if (next.done) break; raw += decoder.decode(next.value); }
    expect(speech(raw)).toBe("One moment... The recipe is saved.");
    expect(completed).toEqual([{ text: speech(raw), outcome: "completed", requiresApproval: false }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not add filler once model speech has started, even when later work takes longer", async () => {
    vi.useFakeTimers();
    const { source, response } = pendingReply(), result = response.text();
    source.enqueue({ type: "text-delta", id: "reply", delta: "Checking the recipe. " });
    await vi.advanceTimersByTimeAsync(3000);
    source.enqueue({ type: "text-delta", id: "reply", delta: "Done." }); source.close();
    expect(speech(await result)).toBe("Checking the recipe. Done.");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["error", "abort", "tool-approval-request"] as const)("cancels pending feedback on %s before slow settlement", async (type) => {
    vi.useFakeTimers();
    const { source, response } = pendingReply(), result = response.text();
    const part: UIMessageChunk = type === "error" ? { type, errorText: "safe failure" }
      : type === "abort" ? { type } : { type, approvalId: "approval", toolCallId: "tool" };
    source.enqueue(part);
    await vi.advanceTimersByTimeAsync(3000); source.close();
    expect(speech(await result)).not.toContain("One moment");
    expect(vi.getTimerCount()).toBe(0);
  });
});
