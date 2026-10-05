"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { ArrowLeft, ArrowUp, History, LoaderCircle, MoreHorizontal, Pencil, Plus, RefreshCw, Settings2, Trash2, X } from "lucide-react";
import type { SiftUIMessage } from "@/ai/assistant-runtime";
import type { ClientPageContext } from "@/domain/assistant";
import { api } from "@/lib/client-http";
import type { Conversation, ConversationList } from "./assistant-shell";
import { AssistantMessage } from "./assistant-message";
import { AssistantDetails } from "./assistant-details";
import { ModelSelector } from "./model-selector";
import { ARTIFACT_CHANGED } from "./use-artifact";
import { artifactPreviewSchema } from "./artifact-card";
import { SiftMark } from "./brand";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

type Props = {
  open: boolean; onOpenChange: (value: boolean) => void; conversation: Conversation | null; history: ConversationList; loading: boolean; loadError: string; pageLabel: string; getPageContext: () => ClientPageContext;
  onSettings: () => void; onNew: () => Promise<void>; onLoad: (id: string) => Promise<void>; onHistory: () => Promise<ConversationList>; onConversationChanged: (conversation: Conversation | null) => void;
};

export function AssistantPanel({ open, onOpenChange, conversation, history, loading, loadError, pageLabel, getPageContext, onSettings, onNew, onLoad, onHistory, onConversationChanged }: Props) {
  const router = useRouter();
  const [input, setInput] = useState(""), [view, setView] = useState<"chat" | "history">("chat"), [action, setAction] = useState<"rename" | "delete" | null>(null), [actionError, setActionError] = useState(""), [actionBusy, setActionBusy] = useState(false), [savedError, setSavedError] = useState(conversation?.lastError ?? ""), [serverBusy, setServerBusy] = useState(conversation?.busy ?? false), [reloading, setReloading] = useState(false);
  const [clientError, setClientError] = useState("");
  const scrollArea = useRef<HTMLDivElement>(null), nearBottom = useRef(true), submitted = useRef<{ id: string; text: string } | null>(null);
  const renderedMutations = useRef(new Set((conversation?.messages ?? []).flatMap((message) => message.parts.filter(isToolUIPart).map((part) => part.toolCallId))));
  const transport = useMemo(() => new DefaultChatTransport<SiftUIMessage>({
    api: "/api/assistant",
    fetch: async (url, options) => {
      const response = await fetch(url, options);
      if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(typeof data?.error === "string" ? data.error : "Sift couldn’t answer. Check your connection and try again."); }
      return response;
    },
    prepareSendMessagesRequest: ({ id, messages, body }) => {
      const common = { conversationId: id, requestId: crypto.randomUUID(), context: getPageContext() };
      if (body?.approval) return { body: { ...common, approval: body.approval } };
      const message = messages.findLast((message) => message.role === "user");
      if (!message) throw new Error("Write a message to Sift first.");
      return { body: { ...common, message: { id: message.id, text: message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n") } } };
    },
  }), [getPageContext]);
  const { messages, status, error, sendMessage, setMessages, clearError, addToolApprovalResponse } = useChat<SiftUIMessage>({
    id: conversation?.id ?? "not-started", messages: (conversation?.messages ?? []) as SiftUIMessage[], transport, generateId: () => crypto.randomUUID(),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onError: (error) => { setClientError(error.message); void reloadSaved(); },
    onFinish: () => {
      router.refresh(); void onHistory().catch(() => undefined);
      if (conversation) void api<Conversation>(`/api/conversations/${conversation.id}`).then((saved) => { onConversationChanged(saved); setServerBusy(saved.busy); setSavedError(saved.lastError ?? ""); }).catch(() => undefined);
    },
  });
  const streaming = status === "submitted" || status === "streaming", busy = streaming || serverBusy || loading || actionBusy || reloading;
  const pendingApproval = messages.some((message) => message.parts.some((part) => isToolUIPart(part) && part.state === "approval-requested" && !part.approval.isAutomatic));
  const liveArtifactReceipts = useMemo(() => {
    const latest = new Map<string, string>();
    for (const message of messages) for (const [index, part] of message.parts.entries()) {
      if (!isToolUIPart(part) || part.state !== "output-available" || !part.output || typeof part.output !== "object" || !("ok" in part.output) || part.output.ok !== true) continue;
      const artifact = artifactPreviewSchema.safeParse(part.output);
      if (artifact.success) latest.set(artifact.data.artifactId, `${message.id}:${index}`);
    }
    return new Set(latest.values());
  }, [messages]);
  const reloadSaved = useCallback(async () => {
    if (!conversation) return;
    setReloading(true); setActionError("");
    try {
      const saved = await api<Conversation>(`/api/conversations/${conversation.id}`);
      setMessages(saved.messages as SiftUIMessage[]); setServerBusy(saved.busy); setSavedError(saved.lastError ?? "");
      onConversationChanged(saved);
      if (submitted.current && !saved.messages.some((message) => message.id === submitted.current?.id)) setInput(submitted.current.text);
      submitted.current = null; clearError(); router.refresh();
    } catch (error) { setActionError(error instanceof Error ? error.message : "Couldn’t load the saved conversation."); }
    finally { setReloading(false); }
  }, [conversation, setMessages, clearError, router, onConversationChanged]);
  useEffect(() => {
    if (!serverBusy || streaming) return;
    const timer = setInterval(() => { void reloadSaved(); }, 2500);
    return () => clearInterval(timer);
  }, [serverBusy, streaming, reloadSaved]);
  useEffect(() => { if (nearBottom.current) scrollArea.current?.scrollTo({ top: scrollArea.current.scrollHeight, behavior: "instant" }); }, [messages, streaming, open]);
  useEffect(() => {
    let changed = false;
    for (const message of messages) for (const part of message.parts) {
      if (!isToolUIPart(part) || part.state !== "output-available" || !["tool-createGroceryList", "tool-deriveGroceryList", "tool-addGroceryItems", "tool-removeGroceryItem", "tool-setGroceryItemChecked", "tool-createMealPlan", "tool-addMealPlanEntry", "tool-removeMealPlanEntry", "tool-startCookingSession", "tool-updateCookingProgress", "tool-finishCookingSession", "tool-abandonCookingSession", "tool-addCookingSessionNote", "tool-createRecipe", "tool-updateRecipe", "tool-archiveRecipe", "tool-restoreArchivedRecipe", "tool-restoreRecipeVersion", "tool-addRecipeNote", "tool-setRecipeFavorite"].includes(part.type) || renderedMutations.current.has(part.toolCallId)) continue;
      renderedMutations.current.add(part.toolCallId);
      if (part.output && typeof part.output === "object" && "ok" in part.output && part.output.ok === true) {
        changed = true;
        if ("artifactId" in part.output && typeof part.output.artifactId === "string") window.dispatchEvent(new CustomEvent(ARTIFACT_CHANGED, { detail: { id: part.output.artifactId } }));
      }
    }
    if (changed) router.refresh();
  }, [messages, router]);
  async function submit() {
    const text = input.trim(); if (!text || busy || pendingApproval || !conversation) return;
    const id = crypto.randomUUID(); submitted.current = { id, text }; setInput(""); setSavedError(""); setClientError(""); setActionError(""); clearError(); nearBottom.current = true;
    await sendMessage({ id, role: "user", parts: [{ type: "text", text }] });
  }
  async function approve(id: string, approved: boolean) {
    setSavedError(""); setClientError(""); setActionError(""); clearError();
    await addToolApprovalResponse({ id, approved, options: { body: { approval: { id, approved } } } });
  }
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetTrigger asChild><Button aria-label="Open Sift" className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-5 z-40 h-12 gap-2 rounded-full border border-foreground/10 px-4 shadow-lg sm:right-8"><SiftMark className="size-5" /><span className="font-medium">sift</span>{streaming && <span aria-label="Reply in progress" className="size-1.5 rounded-full bg-background/70" />}</Button></SheetTrigger>
    <SheetContent side="right" showCloseButton={false} className="h-dvh w-full gap-0 border-l bg-background p-0 sm:w-[420px] sm:max-w-[420px]">
      <SheetHeader className="gap-3 border-b px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))]"><div className="flex items-center justify-between gap-3"><SheetTitle className="flex items-center gap-2 text-xl tracking-tight"><SiftMark className="size-6" />sift</SheetTitle><div className="flex gap-0.5"><Button variant="ghost" size="icon" aria-label="Conversation history" disabled={busy} onClick={async () => { setView(view === "history" ? "chat" : "history"); setAction(null); try { await onHistory(); } catch { setActionError("Couldn’t load conversations. Try again."); } }}><History /></Button><Button variant="ghost" size="icon" aria-label="New conversation" disabled={busy} onClick={() => { setView("chat"); void onNew(); }}><Plus /></Button><SheetClose asChild><Button variant="ghost" size="icon" aria-label="Close Sift"><X /></Button></SheetClose></div></div><SheetDescription className="truncate text-xs">{view === "history" ? "Your conversations" : pageLabel}</SheetDescription></SheetHeader>
      {view === "history" ? <div className="min-h-0 flex-1 overflow-y-auto p-5"><Button variant="ghost" size="sm" className="mb-3" onClick={() => setView("chat")}><ArrowLeft />Back to conversation</Button>{history.length ? <ul className="space-y-2">{history.map((item) => <li key={item.id}><button disabled={loading} className="w-full rounded-xl border p-4 text-left hover:bg-muted disabled:opacity-50" onClick={() => { setView("chat"); void onLoad(item.id); }}><span className="block truncate text-sm font-medium">{item.title}</span><span className="mt-2 block text-xs text-muted-foreground">{new Date(item.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></button></li>)}</ul> : <p className="py-8 text-sm text-muted-foreground">Your conversations will appear here.</p>}</div>
      : <><div className="flex items-center justify-between gap-2 border-b px-5 py-2"><p className="truncate text-xs text-muted-foreground">{conversation?.title || "Your cookbook, with a little help."}</p><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Conversation options" disabled={!conversation || busy}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => { setAction("rename"); setActionError(""); }}><Pencil />Rename conversation</DropdownMenuItem><DropdownMenuItem onSelect={() => { setAction("delete"); setActionError(""); }}><Trash2 />Delete conversation</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
        {action === "rename" && conversation && <form className="space-y-3 border-b p-5" onSubmit={async (event) => {
          event.preventDefault(); setActionBusy(true); setActionError("");
          try { const updated = await api<Conversation>(`/api/conversations/${conversation.id}`, { method: "PATCH", body: { title: String(new FormData(event.currentTarget).get("title")) } }); onConversationChanged(updated); await onHistory(); setAction(null); }
          catch (error) { setActionError(error instanceof Error ? error.message : "Couldn’t rename this conversation."); }
          finally { setActionBusy(false); }
        }}><label className="block text-sm">Conversation title<Input name="title" defaultValue={conversation.title} required maxLength={120} className="mt-2" /></label><div className="flex gap-2"><Button size="sm" disabled={actionBusy} type="submit">Save title</Button><Button size="sm" variant="ghost" type="button" onClick={() => setAction(null)}>Cancel</Button></div></form>}
        {action === "delete" && conversation && <div className="space-y-3 border-b p-5"><p className="text-sm font-medium">Delete this conversation?</p><p className="text-xs leading-relaxed text-muted-foreground">Its messages will be removed. Recipes and notes you saved will stay in your cookbook.</p><div className="flex gap-2"><Button size="sm" disabled={actionBusy} onClick={async () => {
          setActionBusy(true); setActionError("");
          try { await api(`/api/conversations/${conversation.id}`, { method: "DELETE" }); onConversationChanged(null); await onHistory(); await onNew(); }
          catch (error) { setActionError(error instanceof Error ? error.message : "Couldn’t delete this conversation."); }
          finally { setActionBusy(false); }
        }}>Confirm delete</Button><Button size="sm" variant="ghost" disabled={actionBusy} onClick={() => setAction(null)}>Cancel</Button></div></div>}
        <div ref={scrollArea} onScroll={(event) => { const target = event.currentTarget; nearBottom.current = target.scrollHeight - target.scrollTop - target.clientHeight < 100; }} className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-6" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation messages">
          {loading && !conversation ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Opening your conversation…</p> : !messages.length && <div className="py-6 sm:py-10"><SiftMark className="mb-6 size-10 text-muted-foreground" /><h2 className="text-2xl font-medium tracking-tight">What’s cooking?</h2><p className="mt-4 text-sm leading-7 text-muted-foreground">Ask about a recipe, save an idea, or make a dish your own. I can see which recipe you’re reading.</p><div className="mt-6 flex flex-wrap gap-2">{["What can I cook tonight?", "Help me save a recipe"].map((prompt) => <Button key={prompt} variant="outline" size="sm" onClick={() => setInput(prompt)}>{prompt}</Button>)}</div></div>}
          {messages.map((message) => <AssistantMessage key={message.id} message={message} busy={busy} liveArtifactReceipts={liveArtifactReceipts} onApproval={(id, approved) => { void approve(id, approved); }} onNavigate={() => onOpenChange(false)} />)}
          {(streaming || serverBusy) && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{serverBusy && !streaming ? "Sift is finishing the saved reply…" : status === "submitted" ? "Thinking…" : "Sift is replying…"}</p>}
          {(error || clientError || savedError) && <div role="alert" className="rounded-xl border p-4"><p className="text-sm leading-relaxed text-destructive">{error?.message || clientError || savedError}</p><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Check the saved results before sending another message.</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={reloading || streaming} onClick={() => { void reloadSaved(); }}><RefreshCw />Reload saved conversation</Button><Button size="sm" variant="ghost" onClick={onSettings}><Settings2 />Sift settings</Button></div></div>}
          {(loadError || actionError) && <p role="alert" className="text-sm text-destructive">{loadError || actionError}</p>}
          {conversation && <AssistantDetails conversation={conversation} showReceipts={!!(error || clientError || savedError)} onNavigate={() => onOpenChange(false)} />}
          {!conversation && !loading && loadError && <Button variant="outline" onClick={() => onOpenChange(true)}>Try again</Button>}
        </div>
        <form className="border-t bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]" onSubmit={(event) => { event.preventDefault(); void submit(); }}>{conversation && <ModelSelector conversation={conversation} disabled={busy || pendingApproval} onBusy={setActionBusy} onChanged={(saved) => { setMessages(saved.messages as SiftUIMessage[]); setServerBusy(saved.busy); setSavedError(saved.lastError ?? ""); onConversationChanged(saved); }} />}<div className="relative"><Textarea aria-label="Message Sift" disabled={loading || !conversation} value={input} onChange={(event) => setInput(event.target.value)} maxLength={8000} placeholder="Ask Sift…" className="max-h-44 min-h-24 resize-none rounded-2xl bg-muted/35 pb-12 pr-4 text-base sm:text-sm" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia("(min-width: 640px)").matches) { event.preventDefault(); void submit(); } }} /><Button type="submit" size="icon" aria-label="Send message" disabled={busy || pendingApproval || !input.trim() || !conversation} className="absolute bottom-2 right-2 size-9 rounded-xl">{streaming ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}</Button></div><p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground">{pendingApproval ? "Respond to the confirmation above to continue." : "Recipe changes are kept in version history."}</p></form>
      </>}
    </SheetContent>
  </Sheet>;
}
