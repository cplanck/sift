import "server-only";
import type { UIMessageChunk } from "ai";

export type VoiceStreamOutcome = "completed" | "failed" | "aborted";
export type VoiceStreamResult = { text: string; outcome: VoiceStreamOutcome; requiresApproval: boolean };
const failed = "Sift couldn’t finish that response. Open the conversation to review your saved changes before trying again.";
const interrupted = "I stopped that reply. Some changes may already be saved; check the conversation.";
const confirmation = "Please approve or decline that action using the confirmation in Sift.";

// Speech is an encoding of the same native SDK UI stream. Tool calls/results,
// reasoning, approval IDs and other structured parts never enter TTS output.
export function createVoiceStreamResponse(options: {
  stream: ReadableStream<UIMessageChunk>;
  responseId: string;
  getOutcome: () => VoiceStreamOutcome;
  getErrorMessage?: () => string;
  onEnd?: (result: VoiceStreamResult) => Promise<void>;
  waitUntil?: (task: Promise<void>) => void;
}) {
  const encoder = new TextEncoder(), created = Math.floor(Date.now() / 1000);
  let text = "", requiresApproval = false, sawError = false, sawAbort = false;
  function chunk(delta: { role?: "assistant"; content?: string }, finishReason: "stop" | null = null) {
    return encoder.encode(`data: ${JSON.stringify({ id: options.responseId, object: "chat.completion.chunk", created, model: "sift", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
  }
  const encoded = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(chunk({ role: "assistant" }));
      // ElevenLabs needs content, not just a role chunk, while an agentic
      // reply starts. Give slow turns audible feedback without another model
      // call or putting transport filler into the canonical conversation.
      const acknowledgement = setTimeout(() => {
        text += "One moment... ";
        controller.enqueue(chunk({ content: "One moment... " }));
      }, 1000);
      const reader = options.stream.getReader();
      try {
        while (true) {
          const { value: part, done } = await reader.read();
          if (done) break;
          if (part.type === "text-delta") { if (part.delta) clearTimeout(acknowledgement); text += part.delta; controller.enqueue(chunk({ content: part.delta })); }
          else if (part.type === "tool-approval-request") { clearTimeout(acknowledgement); requiresApproval = true; }
          else if (part.type === "error") { clearTimeout(acknowledgement); sawError = true; }
          else if (part.type === "abort") { clearTimeout(acknowledgement); sawAbort = true; }
        }
      } catch {
        // A source failure skips TransformStream.flush. Recover here so every
        // accepted voice turn still gets its durable terminal callback.
        sawError = true;
      } finally { clearTimeout(acknowledgement); reader.releaseLock(); }
      const recorded = options.getOutcome();
      const outcome = sawAbort || recorded === "aborted" ? "aborted" : sawError || recorded === "failed" ? "failed" : "completed";
      const explanation = outcome === "aborted" ? interrupted : outcome === "failed" ? options.getErrorMessage?.() ?? failed : requiresApproval ? confirmation : "";
      if (explanation) {
        const addition = `${text ? "\n\n" : ""}${explanation}`;
        text += addition; controller.enqueue(chunk({ content: addition }));
      }
      // The source stream runs the SDK's onEnd persistence before it closes.
      // Save the exact text handed to speech before announcing completion.
      await options.onEnd?.({ text, outcome, requiresApproval });
      controller.enqueue(chunk({}, "stop"));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  const [outgoing, durable] = encoded.tee();
  // Keep SDK settlement and usage accounting alive if ElevenLabs disconnects.
  // Its HTTP AbortSignal separately stops generation on a best-effort basis.
  const completion = durable.pipeTo(new WritableStream({ write() {} })).catch(() => {
    console.error(JSON.stringify({ event: "voice.stream_failed", responseId: options.responseId }));
  });
  options.waitUntil?.(completion);
  return new Response(outgoing, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store", "X-Accel-Buffering": "no" } });
}
