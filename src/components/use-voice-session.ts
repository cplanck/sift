"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConversation, useConversationControls, useConversationInput, useConversationMode, useConversationStatus } from "@elevenlabs/react";
import { isToolUIPart } from "ai";
import type { ClientPageContext } from "@/domain/assistant";
import type { VoiceSessionInfo, VoiceSessionStart, VoiceStatus } from "@/domain/voice";
import { api } from "@/lib/client-http";
import type { Conversation } from "./assistant-shell";

export type VoicePhase = "idle" | "checking" | "permission" | "connecting" | "updating" | "listening" | "thinking" | "speaking" | "muted" | "ending" | "error";
type Options = {
  ensureConversation: () => Promise<Conversation>;
  getPageContext: () => ClientPageContext;
  contextSignal: string;
  refreshConversation: (id: string) => Promise<Conversation | null>;
  openTranscript: () => void;
};
export type SiftVoice = ReturnType<typeof useVoiceSession>;
function permissionError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access is blocked. Allow it in your browser’s site settings, then try again. You can keep using text.";
  if (name === "NotFoundError") return "No microphone was found. Connect one or keep using text.";
  if (name === "NotReadableError") return "Your microphone is unavailable. Check whether another app is using it, then try again.";
  return error instanceof Error ? error.message : "Voice couldn’t start. Check your connection and try again.";
}
export function useVoiceSession({ ensureConversation, getPageContext, contextSignal, refreshConversation, openTranscript }: Options) {
  const controls = useConversationControls(), input = useConversationInput(), mode = useConversationMode(), connection = useConversationStatus();
  const [stage, setStage] = useState<"idle" | "checking" | "permission" | "connecting" | "connected" | "ending">("idle");
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [thinking, setThinking] = useState(false), [updating, setUpdating] = useState(false);
  const [caption, setCaption] = useState<{ speaker: "You" | "Sift"; text: string } | null>(null);
  const session = useRef<VoiceSessionInfo | null>(null), wanted = useRef(false), generation = useRef(0), userMuted = useRef(false), boundContext = useRef("");
  const bootstrap = useRef<AbortController | null>(null), syncQueue = useRef<Promise<void>>(Promise.resolve()), refreshInFlight = useRef<Promise<void> | null>(null);
  const ending = useRef<Promise<void> | null>(null), initialError = useRef("");
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null), expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { startSession, endSession } = controls, { setMuted: setSdkMuted } = input;
  const setMuted = useCallback((muted: boolean) => {
    try { setSdkMuted(muted); }
    catch (error) {
      // The SDK releases its instance before disconnect callbacks and rejects
      // mute calls before a call exists. Both are already microphone-off states.
      if (!(error instanceof Error) || error.message !== "No active conversation. Call startSession() first.") throw error;
    }
  }, [setSdkMuted]);

  const end = useCallback((message = "", confirmation = false): Promise<void> => {
    if (ending.current) return ending.current;
    wanted.current = false; generation.current++; bootstrap.current?.abort(); bootstrap.current = null;
    const previous = session.current; session.current = null;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    setMuted(true); endSession(); setThinking(false); setUpdating(false); setStage("ending");
    setError(message); setNotice(confirmation ? "Confirm the action in Sift to continue. Voice has stopped." : "");
    const task = Promise.resolve().then(async () => {
      try { if (previous) await api(`/api/voice/sessions/${previous.id}`, { method: "DELETE" }); }
      catch { if (!message) setNotice("Voice has stopped on this device. The server connection will close when its short lease expires."); }
      finally {
        if (previous?.conversationId) {
          const saved = await refreshConversation(previous.conversationId).catch(() => null);
          if (saved?.lastError && JSON.stringify([saved.lastError, saved.messages.at(-1)?.id]) !== initialError.current) setError(saved.lastError);
        }
        setStage("idle"); ending.current = null;
        if (confirmation) openTranscript();
      }
    });
    ending.current = task; return task;
  }, [endSession, setMuted, refreshConversation, openTranscript]);

  const refreshSaved = useCallback(function refreshSaved(): Promise<void> {
    if (refreshInFlight.current) return refreshInFlight.current;
    const current = session.current;
    if (!current?.conversationId || !wanted.current) return Promise.resolve();
    const task = (async () => {
      try {
        const saved = await refreshConversation(current.conversationId!);
        if (!wanted.current || session.current?.id !== current.id || !saved) return;
        const approval = saved.messages.some((message) => message.parts.some((part) => isToolUIPart(part) && part.state === "approval-requested" && !part.approval.isAutomatic));
        if (approval) { await end("", true); return; }
        if (saved.lastError && !saved.busy && JSON.stringify([saved.lastError, saved.messages.at(-1)?.id]) !== initialError.current) { await end(saved.lastError); return; }
        if (saved.busy) refreshTimer.current = setTimeout(() => { void refreshSaved(); }, 1500);
        else setThinking(false);
      } catch { /* A failed receipt refresh is retried at the next event or heartbeat. */ }
    })();
    refreshInFlight.current = task;
    void task.finally(() => { if (refreshInFlight.current === task) refreshInFlight.current = null; });
    return task;
  }, [refreshConversation, end]);

  const synchronize = useCallback(() => {
    // Mute immediately when navigation changes context, even if an earlier
    // heartbeat is still in flight. Resume only after the latest page is bound.
    if (session.current && wanted.current && JSON.stringify(getPageContext()) !== boundContext.current) { setUpdating(true); setMuted(true); }
    const task = syncQueue.current.catch(() => undefined).then(async () => {
      const current = session.current;
      if (!current || !wanted.current) return;
      const context = getPageContext(), serialized = JSON.stringify(context), changed = serialized !== boundContext.current;
      if (changed) { setUpdating(true); setMuted(true); }
      try {
        const saved = await api<VoiceSessionInfo>(`/api/voice/sessions/${current.id}`, { method: "PATCH", body: { context, expectedRevision: current.revision } });
        if (!wanted.current || session.current?.id !== current.id) return;
        session.current = saved; boundContext.current = serialized;
        if (JSON.stringify(getPageContext()) === serialized) { setUpdating(false); setMuted(userMuted.current); }
        void refreshSaved();
      } catch (error) {
        if (wanted.current && session.current?.id === current.id) await end(error instanceof Error ? error.message : "Voice lost its connection to this page. Reconnect or continue with text.");
      }
    });
    syncQueue.current = task;
    return task;
  }, [getPageContext, setMuted, refreshSaved, end]);

  useConversation({
    onConnect: ({ conversationId }) => {
      if (!wanted.current) { endSession(); return; }
      if (session.current?.providerConversationId !== conversationId) { void end("Voice couldn’t verify its connection. Please try again."); return; }
      setStage("connected"); setMuted(userMuted.current); void synchronize();
    },
    onDisconnect: (details) => {
      if (!wanted.current) return;
      void end(details.reason === "error" ? "Voice disconnected. Check your connection, then reconnect or continue with text." : "");
    },
    onError: () => { if (wanted.current) void end("Voice couldn’t connect. Check your microphone and connection, then try again or continue with text."); },
    onMessage: ({ role, message }) => {
      if (!wanted.current) return;
      setCaption({ speaker: role === "user" ? "You" : "Sift", text: message.slice(0, 2000) });
      if (role === "user") {
        setThinking(true);
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => { void refreshSaved(); }, 1000);
      } else void refreshSaved();
    },
    onInterruption: () => { if (wanted.current) setThinking(false); },
    onAgentResponseCorrection: ({ corrected_agent_response }) => {
      if (wanted.current) { setCaption({ speaker: "Sift", text: corrected_agent_response.slice(0, 2000) }); void refreshSaved(); }
    },
  });

  const start = useCallback(async () => {
    if (wanted.current || stage === "ending") return;
    const attempt = ++generation.current; wanted.current = true; userMuted.current = false;
    const controller = new AbortController(); bootstrap.current = controller;
    setError(""); setNotice(""); setCaption(null); setThinking(false); setStage("checking");
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof window.RTCPeerConnection !== "function") throw new Error("Voice isn’t supported in this browser. Use a current browser over HTTPS, or keep using text.");
      if (!navigator.onLine) throw new Error("Voice needs an internet connection. Your saved recipe is still available.");
      const status = await api<VoiceStatus>("/api/voice/status", { signal: controller.signal });
      if (!status.configured) throw new Error(status.message || "Voice isn’t configured yet. You can keep using Sift with text.");
      if (!wanted.current || generation.current !== attempt) return;
      setStage("permission");
      // Ask only after a tap, and release this permission probe immediately.
      // The SDK owns the actual call microphone and its cleanup.
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphone.getTracks().forEach((track) => track.stop());
      if (!wanted.current || generation.current !== attempt) return;
      setStage("connecting");
      const conversation = await ensureConversation();
      if (!wanted.current || generation.current !== attempt) return;
      initialError.current = JSON.stringify([conversation.lastError, conversation.messages.at(-1)?.id]);
      const context = getPageContext();
      const created = await api<VoiceSessionStart>("/api/voice/sessions", { method: "POST", signal: controller.signal, body: { conversationId: conversation.id, context } });
      if (!wanted.current || generation.current !== attempt) { await api(`/api/voice/sessions/${created.id}`, { method: "DELETE" }).catch(() => undefined); return; }
      session.current = created; boundContext.current = JSON.stringify(context);
      expiryTimer.current = setTimeout(() => { void end("This voice session reached its time limit. Reconnect to continue in the same conversation."); }, Math.max(0, Date.parse(created.expiresAt) - Date.now()));
      setMuted(false);
      startSession({ conversationToken: created.conversationToken, connectionType: "webrtc", useWakeLock: false });
    } catch (error) {
      if (generation.current === attempt && wanted.current) await end(permissionError(error));
    } finally { if (bootstrap.current === controller) bootstrap.current = null; }
  }, [stage, ensureConversation, getPageContext, setMuted, startSession, end]);

  useEffect(() => { void synchronize(); }, [contextSignal, synchronize]);
  useEffect(() => {
    if (stage !== "connected") return;
    const heartbeat = setInterval(() => { void synchronize(); }, 20_000);
    const disconnected = () => { void end("You’re offline. Voice has stopped. Reconnect when you’re back online, or continue with text."); };
    window.addEventListener("offline", disconnected);
    return () => { clearInterval(heartbeat); window.removeEventListener("offline", disconnected); };
  }, [stage, synchronize, end]);
  useEffect(() => {
    const release = () => {
      wanted.current = false; generation.current++; bootstrap.current?.abort();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      const previous = session.current; session.current = null;
      setMuted(true); endSession();
      if (previous) void fetch(`/api/voice/sessions/${previous.id}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
    };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) { setStage("idle"); setThinking(false); setUpdating(false); setNotice("Voice stopped when you left this page. Start it again when you’re ready."); } };
    window.addEventListener("pagehide", release);
    window.addEventListener("pageshow", restore);
    return () => { window.removeEventListener("pagehide", release); window.removeEventListener("pageshow", restore); release(); };
  }, [endSession, setMuted]);

  const busy = stage !== "idle";
  const phase: VoicePhase = stage === "idle" ? error ? "error" : "idle" : stage !== "connected" ? stage : updating ? "updating" : input.isMuted ? "muted" : mode.isSpeaking ? "speaking" : thinking ? "thinking" : connection.status === "connected" ? "listening" : "connecting";
  return { phase, busy, error, notice, caption, isMuted: input.isMuted, start, end,
    toggleMute: () => { userMuted.current = !input.isMuted; setMuted(userMuted.current || updating); },
    dismiss: () => { setError(""); setNotice(""); },
  };
}
