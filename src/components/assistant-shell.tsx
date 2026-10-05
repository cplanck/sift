"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ConversationProvider } from "@elevenlabs/react";
import type { ClientPageContext } from "@/domain/assistant";
import type { getConversation, listConversations } from "@/services/conversations";
import { api } from "@/lib/client-http";
import { AssistantPanel } from "./assistant-panel";
import { GatewaySettings } from "./gateway-settings";
import { useVoiceSession, type SiftVoice } from "./use-voice-session";
import { VoiceControls } from "./voice-controls";

export type Conversation = Awaited<ReturnType<typeof getConversation>>;
export type ConversationList = Awaited<ReturnType<typeof listConversations>>;
type PageRegistration = ClientPageContext & { title: string };
const AssistantContext = createContext<{ registerPage: (context: PageRegistration) => () => void; openSettings: () => void; openAssistant: () => void; voice: SiftVoice } | null>(null);

export function useAssistantPage(context: PageRegistration) {
  const shell = useContext(AssistantContext);
  const register = shell?.registerPage;
  const { route, activeRecipeId, activeRecipeVersionId, activeCookingSessionId, activeArtifactId, title } = context;
  useEffect(() => register?.({ route, activeRecipeId, activeRecipeVersionId, activeCookingSessionId, activeArtifactId, title }), [register, route, activeRecipeId, activeRecipeVersionId, activeCookingSessionId, activeArtifactId, title]);
}
export function useOpenSift() { return useContext(AssistantContext)?.openAssistant; }
export function useSiftSettings() { return useContext(AssistantContext)?.openSettings; }
export function useSiftVoice() { return useContext(AssistantContext)?.voice; }

export function AssistantShell({ children }: { children: React.ReactNode }) {
  return <ConversationProvider useWakeLock={false}><AssistantShellContent>{children}</AssistantShellContent></ConversationProvider>;
}
function AssistantShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false), [page, setPage] = useState<PageRegistration | null>(null), [conversation, setConversation] = useState<Conversation | null>(null), [history, setHistory] = useState<ConversationList>([]), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const registeredPage = useRef<PageRegistration | null>(null);
  const conversationRef = useRef(conversation), opening = useRef<Promise<Conversation> | null>(null);
  const voiceListeners = useRef(new Set<(saved: Conversation) => void>());
  useEffect(() => { conversationRef.current = conversation; }, [conversation]);
  const registerPage = useCallback((context: PageRegistration) => {
    registeredPage.current = context; setPage(context);
    return () => { if (registeredPage.current === context) { registeredPage.current = null; setPage(null); } };
  }, []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const updateConversation = useCallback((updated: Conversation | null) => {
    setConversation((current) => updated === null ? null : current?.id === updated.id ? updated : current);
  }, []);
  const getPageContext = useCallback((): ClientPageContext => {
    const route = window.location.pathname + window.location.search, context = registeredPage.current;
    return context?.route === route ? { route, activeRecipeId: context.activeRecipeId, activeRecipeVersionId: context.activeRecipeVersionId, activeCookingSessionId: context.activeCookingSessionId, activeArtifactId: context.activeArtifactId } : { route };
  }, []);
  const refreshHistory = useCallback(async () => {
    const records = await api<ConversationList>("/api/conversations"); setHistory(records); return records;
  }, []);
  const ensureConversation = useCallback(async () => {
    if (conversationRef.current) return conversationRef.current;
    if (opening.current) return opening.current;
    setLoading(true); setError("");
    const task = (async () => {
      const records = await refreshHistory();
      const saved = records.length ? await api<Conversation>(`/api/conversations/${records[0].id}`) : await api<Conversation>("/api/conversations", { body: {} });
      conversationRef.current = saved; setConversation(saved); return saved;
    })();
    opening.current = task;
    try { return await task; }
    finally { opening.current = null; setLoading(false); }
  }, [refreshHistory]);
  const refreshVoiceConversation = useCallback(async (id: string) => {
    const saved = await api<Conversation>(`/api/conversations/${id}`);
    if (conversationRef.current?.id === id) {
      conversationRef.current = saved; setConversation(saved);
      voiceListeners.current.forEach((listener) => listener(saved));
    }
    void refreshHistory().catch(() => undefined);
    return saved;
  }, [refreshHistory]);
  const subscribeVoiceConversation = useCallback((listener: (saved: Conversation) => void) => {
    voiceListeners.current.add(listener);
    return () => { voiceListeners.current.delete(listener); };
  }, []);
  const openTranscript = useCallback(() => setOpen(true), []);
  const voice = useVoiceSession({ ensureConversation, getPageContext, contextSignal: JSON.stringify({ pathname, page }), refreshConversation: refreshVoiceConversation, openTranscript });
  async function loadConversation(id: string) {
    setLoading(true); setError("");
    try { setConversation(await api<Conversation>(`/api/conversations/${id}`)); }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn’t open this conversation."); }
    finally { setLoading(false); }
  }
  async function newConversation() {
    setLoading(true); setError("");
    try { const created = await api<Conversation>("/api/conversations", { body: {} }); setConversation(created); await refreshHistory(); }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn’t start a conversation."); }
    finally { setLoading(false); }
  }
  async function openPanel(value: boolean) {
    setOpen(value);
    if (!value) return;
    try { await ensureConversation(); }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn’t open Sift."); }
  }
  const voiceVisible = voice.busy || !!voice.error || !!voice.notice;
  async function switchToText() { await voice.end(); await openPanel(true); }
  const pageLabel = page?.route.split("?")[0] === pathname ? page.title : pathname === "/library" ? "Your cookbook" : pathname === "/recipes/new" ? "Adding a recipe" : "Your cookbook";
  return <AssistantContext.Provider value={{ registerPage, openSettings, openAssistant: () => { void openPanel(true); }, voice }}>{children}
    <AssistantPanel key={conversation?.id ?? "empty"} open={open} onOpenChange={openPanel} conversation={conversation} history={history} loading={loading} loadError={error} pageLabel={pageLabel} getPageContext={getPageContext} onSettings={openSettings} onNew={newConversation} onLoad={loadConversation} onHistory={refreshHistory} onConversationChanged={updateConversation} voice={voice} subscribeVoiceConversation={subscribeVoiceConversation} />
    {voiceVisible && !open && <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 right-4 z-40 sm:left-auto sm:right-6 sm:w-[380px]"><VoiceControls voice={voice} compact onTranscript={openTranscript} onText={() => void switchToText()} /></div>}
    <GatewaySettings open={settingsOpen} onOpenChange={setSettingsOpen} />
  </AssistantContext.Provider>;
}
