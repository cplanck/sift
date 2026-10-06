"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { ConversationProvider } from "@elevenlabs/react";
import type { ClientPageContext } from "@/domain/assistant";
import type { getConversation, listConversations } from "@/services/conversations";
import { api } from "@/lib/client-http";
import { AssistantPanel } from "./assistant-panel";
import { dockWidthLimits } from "./assistant-dock";
import { GatewaySettings } from "./gateway-settings";
import { useVoiceSession, type SiftVoice } from "./use-voice-session";
import { VoiceDetailsDialog } from "./voice-controls";
import { ResumeCooking } from "./resume-cooking";

export type Conversation = Awaited<ReturnType<typeof getConversation>>;
export type ConversationList = Awaited<ReturnType<typeof listConversations>>;
type PageRegistration = ClientPageContext & { title: string };
const AssistantContext = createContext<{ registerPage: (context: PageRegistration) => () => void; openSettings: () => void; openAssistant: () => void; assistantOpen: boolean; toggleAssistant: () => void; setCookingHost: (host: HTMLDivElement | null) => void; voice: SiftVoice } | null>(null);

export function useAssistantPage(context: PageRegistration) {
  const shell = useContext(AssistantContext);
  const register = shell?.registerPage;
  const { route, activeRecipeId, activeRecipeVersionId, activeCookingSessionId, activeArtifactId, title } = context;
  useEffect(() => register?.({ route, activeRecipeId, activeRecipeVersionId, activeCookingSessionId, activeArtifactId, title }), [register, route, activeRecipeId, activeRecipeVersionId, activeCookingSessionId, activeArtifactId, title]);
}
export function useAssistantVisibility() { const shell = useContext(AssistantContext); return { open: shell?.assistantOpen ?? false, toggle: shell?.toggleAssistant }; }
export function useCookingAssistantHost() { return useContext(AssistantContext)?.setCookingHost; }
export function useOpenSift() { return useContext(AssistantContext)?.openAssistant; }
export function useSiftSettings() { return useContext(AssistantContext)?.openSettings; }
export function useSiftVoice() { return useContext(AssistantContext)?.voice; }

// While cooking on a wide screen, Sift docks as a resizable right sidebar, open
// by default, so hands-busy questions never need the panel reopened.
const dockQuery = "(min-width: 1024px)", dockKey = "sift.assistant.dock.v1", dockEvent = "sift:assistant-dock";
type DockPreference = { open: boolean; width: number };
function subscribeWide(listener: () => void) { const query = window.matchMedia(dockQuery); query.addEventListener("change", listener); return () => query.removeEventListener("change", listener); }
function subscribeDock(listener: () => void) {
  const changed = (event: StorageEvent) => { if (event.key === dockKey) listener(); };
  window.addEventListener(dockEvent, listener); window.addEventListener("storage", changed);
  return () => { window.removeEventListener(dockEvent, listener); window.removeEventListener("storage", changed); };
}
let memoryDock = "";
function readDock() { try { return localStorage.getItem(dockKey) ?? memoryDock; } catch { return memoryDock; } }
function parseDock(raw: string): DockPreference {
  try { const value = JSON.parse(raw) as Partial<DockPreference>; return { open: value.open !== false, width: Math.min(dockWidthLimits.max, Math.max(dockWidthLimits.min, Number(value.width) || dockWidthLimits.initial)) }; }
  catch { return { open: true, width: dockWidthLimits.initial }; }
}
function writeDock(change: Partial<DockPreference>) {
  const next = JSON.stringify({ ...parseDock(readDock()), ...change });
  memoryDock = next;
  try { localStorage.setItem(dockKey, next); } catch { /* Kept in memory for this tab. */ }
  window.dispatchEvent(new Event(dockEvent));
}

export function AssistantShell({ children }: { children: React.ReactNode }) {
  return <ConversationProvider useWakeLock={false}><AssistantShellContent>{children}</AssistantShellContent></ConversationProvider>;
}
function AssistantShellContent({ children }: { children: React.ReactNode }) {
  const [cookingHost, setCookingHost] = useState<HTMLDivElement | null>(null);
  const pathname = usePathname();
  const [voiceDetailsOpen, setVoiceDetailsOpen] = useState(false);
  const [open, setOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false), [page, setPage] = useState<PageRegistration | null>(null), [conversation, setConversation] = useState<Conversation | null>(null), [history, setHistory] = useState<ConversationList>([]), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const registeredPage = useRef<PageRegistration | null>(null);
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(dockQuery).matches, () => false);
  const dock = parseDock(useSyncExternalStore(subscribeDock, readDock, () => ""));
  const cooking = !!page?.activeCookingSessionId && page.route.split("?")[0] === pathname;
  const docked = wide && cooking, panelOpen = docked ? dock.open : open;
  const [draft, setDraft] = useState("");
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
  const openTranscript = useCallback(() => { if (docked) writeDock({ open: true }); else setOpen(true); }, [docked]);
  // A docked sidebar is open on arrival, so load its conversation without a tap.
  useEffect(() => {
    if (docked && dock.open && !conversationRef.current && !opening.current) void ensureConversation().catch((error: unknown) => setError(error instanceof Error ? error.message : "Couldn’t open Sift."));
  }, [docked, dock.open, ensureConversation]);
  const voice = useVoiceSession({ ensureConversation, getPageContext, contextSignal: JSON.stringify({ pathname, page }), refreshConversation: refreshVoiceConversation, openTranscript });
  async function loadConversation(id: string) {
    setLoading(true); setError("");
    if (conversationRef.current?.id !== id) setDraft("");
    try { setConversation(await api<Conversation>(`/api/conversations/${id}`)); }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn’t open this conversation."); }
    finally { setLoading(false); }
  }
  async function newConversation() {
    setLoading(true); setError(""); setDraft("");
    try { const created = await api<Conversation>("/api/conversations", { body: {} }); setConversation(created); await refreshHistory(); }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn’t start a conversation."); }
    finally { setLoading(false); }
  }
  async function openPanel(value: boolean) {
    if (docked) writeDock({ open: value }); else setOpen(value);
    if (!value) return;
    try { await ensureConversation(); }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn’t open Sift."); }
  }
  async function showText(endVoice: boolean) {
    if (endVoice) await voice.end();
    setVoiceDetailsOpen(false);
    await openPanel(true);
    requestAnimationFrame(() => document.getElementById("sift-composer")?.focus());
  }
  const pageLabel = page?.route.split("?")[0] === pathname ? page.title : pathname === "/library" ? "Your cookbook" : pathname === "/recipes/new" ? "Adding a recipe" : "Your cookbook";
  const dockedOpen = docked && dock.open;
  return <AssistantContext.Provider value={{ registerPage, openSettings, openAssistant: () => { void openPanel(true); }, assistantOpen: panelOpen, toggleAssistant: () => { void openPanel(!panelOpen); }, setCookingHost, voice }}>
    {/* The page makes room for the docked sidebar instead of sitting under it. */}
    <div className="sift-dock-room" style={dockedOpen && !cookingHost ? { paddingRight: dock.width } : undefined}>{children}</div>
    <AssistantPanel key={conversation?.id ?? "empty"} open={panelOpen} onOpenChange={openPanel} cooking={cooking} docked={docked} dockContainer={cookingHost} dockWidth={dock.width} onDockResize={(width) => writeDock({ width })} conversation={conversation} history={history} loading={loading} loadError={error} pageLabel={pageLabel} getPageContext={getPageContext} onSettings={openSettings} onNew={newConversation} onLoad={loadConversation} onHistory={refreshHistory} onConversationChanged={updateConversation} voice={voice} onVoiceDetails={() => setVoiceDetailsOpen(true)} subscribeVoiceConversation={subscribeVoiceConversation} input={draft} onInputChange={setDraft} />
    <VoiceDetailsDialog open={voiceDetailsOpen} onOpenChange={setVoiceDetailsOpen} voice={voice} onText={() => void showText(true)} onTranscript={() => void showText(false)} />
    <GatewaySettings open={settingsOpen} onOpenChange={setSettingsOpen} />
    {!cooking && <ResumeCooking />}
  </AssistantContext.Provider>;
}
