"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { ClientPageContext } from "@/domain/assistant";
import type { getConversation, listConversations } from "@/services/conversations";
import { api } from "@/lib/client-http";
import { AssistantPanel } from "./assistant-panel";
import { GatewaySettings } from "./gateway-settings";

export type Conversation = Awaited<ReturnType<typeof getConversation>>;
export type ConversationList = Awaited<ReturnType<typeof listConversations>>;
type PageRegistration = ClientPageContext & { title: string };
const AssistantContext = createContext<{ registerPage: (context: PageRegistration) => () => void; openSettings: () => void; openAssistant: () => void } | null>(null);

export function useAssistantPage(context: PageRegistration) {
  const shell = useContext(AssistantContext);
  const register = shell?.registerPage;
  const { route, activeRecipeId, activeRecipeVersionId, activeCookingSessionId, title } = context;
  useEffect(() => register?.({ route, activeRecipeId, activeRecipeVersionId, activeCookingSessionId, title }), [register, route, activeRecipeId, activeRecipeVersionId, activeCookingSessionId, title]);
}
export function useOpenSift() { return useContext(AssistantContext)?.openAssistant; }
export function useSiftSettings() { return useContext(AssistantContext)?.openSettings; }

export function AssistantShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false), [page, setPage] = useState<PageRegistration | null>(null), [conversation, setConversation] = useState<Conversation | null>(null), [history, setHistory] = useState<ConversationList>([]), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const registeredPage = useRef<PageRegistration | null>(null);
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
    return context?.route === route ? { route, activeRecipeId: context.activeRecipeId, activeRecipeVersionId: context.activeRecipeVersionId, activeCookingSessionId: context.activeCookingSessionId } : { route };
  }, []);
  const refreshHistory = useCallback(async () => {
    const records = await api<ConversationList>("/api/conversations"); setHistory(records); return records;
  }, []);
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
    if (!value || conversation || loading) return;
    setLoading(true); setError("");
    try {
      const records = await refreshHistory();
      setConversation(records.length ? await api<Conversation>(`/api/conversations/${records[0].id}`) : await api<Conversation>("/api/conversations", { body: {} }));
    } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t open Sift."); }
    finally { setLoading(false); }
  }
  const pageLabel = page?.route.split("?")[0] === pathname ? page.title : pathname === "/library" ? "Your cookbook" : pathname === "/recipes/new" ? "Adding a recipe" : "Your cookbook";
  return <AssistantContext.Provider value={{ registerPage, openSettings, openAssistant: () => { void openPanel(true); } }}>{children}
    <AssistantPanel key={conversation?.id ?? "empty"} open={open} onOpenChange={openPanel} conversation={conversation} history={history} loading={loading} loadError={error} pageLabel={pageLabel} getPageContext={getPageContext} onSettings={openSettings} onNew={newConversation} onLoad={loadConversation} onHistory={refreshHistory} onConversationChanged={updateConversation} />
    <GatewaySettings open={settingsOpen} onOpenChange={setSettingsOpen} />
  </AssistantContext.Provider>;
}
