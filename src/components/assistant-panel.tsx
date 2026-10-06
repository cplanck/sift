"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { AlertCircle, ArrowDown, ArrowUp, AudioLines, ImagePlus, BookOpen, CalendarDays, ChevronDown, Check, History, ListChecks, LoaderCircle, Mic, Pencil, PhoneOff, Plus, ReceiptText, RefreshCw, Settings2, SlidersHorizontal, Square, Trash2, X } from "lucide-react";
import type { SiftUIMessage } from "@/ai/assistant-runtime";
import type { ClientPageContext } from "@/domain/assistant";
import { api } from "@/lib/client-http";
import type { Conversation, ConversationList } from "./assistant-shell";
import { dockWidthLimits } from "./assistant-dock";
import { AssistantMessage } from "./assistant-message";
import { AssistantActivity, AssistantThinking } from "./assistant-thinking";
import { AssistantDetails } from "./assistant-details";
import { ModelSelector } from "./model-selector";
import type { SiftVoice } from "./use-voice-session";
import { useDictation } from "./use-dictation";
import { isSentEcho } from "./composer-echo";
import { maxChatPhotos, useChatPhotos } from "./use-chat-photos";
import Image from "next/image";
import { MobileNavigation } from "./mobile-navigation";
import { VoiceIndicator, VoiceLauncher, voiceLabels } from "./voice-launcher";
import { AiUsageDetails } from "./ai-usage-details";
import styles from "./assistant-panel.module.css";
import { MicrophoneSettings } from "./microphone-settings";
import { ARTIFACT_CHANGED } from "./use-artifact";
import { artifactPreviewSchema } from "./artifact-card";
import { SiftMark } from "./brand";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "./ui/dropdown-menu";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

// Tool results that change what the current page shows, or move to another page.
const pageEffects = new Set(["addShoppingRecipe", "removeShoppingRecipe", "updateShoppingRecipe", "createCookingTimer", "updateCookingTimer", "createGroceryList", "deriveGroceryList", "addGroceryItems", "removeGroceryItem", "setGroceryItemChecked", "updateGroceryItem", "categorizeGroceryItems", "setShoppingListArchived", "clearCheckedGroceryItems", "createMealPlan", "addMealPlanEntry", "removeMealPlanEntry", "updateMealPlanEntry", "renameArtifact", "deleteArtifact",
  "startCookingSession", "updateCookingProgress", "finishCookingSession", "abandonCookingSession", "addCookingSessionNote", "createRecipe", "updateRecipe", "archiveRecipe", "restoreArchivedRecipe", "restoreRecipeVersion", "addRecipeNote", "setRecipeFavorite",
  "setRecipeFavorites", "tagRecipes", "setRecipeCoverPhoto", "generateRecipeCover", "removeRecipeCover", "addPhotoToRecipe", "addPhotoToCook", "importRecipe", "approveImportDraft", "createShareLink", "revokeShareLink", "navigate"].map((name) => `tool-${name}`));

type Props = {
  open: boolean; onOpenChange: (value: boolean) => void; conversation: Conversation | null; history: ConversationList; loading: boolean; loadError: string; pageLabel: string; getPageContext: () => ClientPageContext;
  onSettings: () => void; onNew: () => Promise<void>; onLoad: (id: string) => Promise<void>; onHistory: () => Promise<ConversationList>; onConversationChanged: (conversation: Conversation | null) => void;
  voice: SiftVoice; onVoiceDetails: () => void; subscribeVoiceConversation: (listener: (saved: Conversation) => void) => () => void;
  /** Owned by the shell so a draft typed while loading survives this panel remounting per conversation. */
  input: string; onInputChange: (value: string) => void;
  /** Wide screens: a non-modal, resizable right sidebar instead of a modal sheet. */
  cooking: boolean; docked: boolean; dockContainer?: HTMLElement | null; dockWidth: number; onDockResize: (width: number) => void;
};

export function AssistantPanel({ open, onOpenChange, conversation, history, loading, loadError, pageLabel, getPageContext, onSettings, onNew, onLoad, onHistory, onConversationChanged, voice, onVoiceDetails, subscribeVoiceConversation, input, onInputChange: setInput, cooking, docked, dockContainer, dockWidth, onDockResize }: Props) {
  const router = useRouter();
  const [action, setAction] = useState<"rename" | "delete" | null>(null), [actionError, setActionError] = useState(""), [actionBusy, setActionBusy] = useState(false), [savedError, setSavedError] = useState(conversation?.lastError ?? ""), [serverBusy, setServerBusy] = useState(conversation?.busy ?? false), [reloading, setReloading] = useState(false);
  const [clientError, setClientError] = useState("");
  const [showLatest, setShowLatest] = useState(false);
  const [showCookingHistory, setShowCookingHistory] = useState(false);
  const [conversationSettingsOpen, setConversationSettingsOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false), [historyLoading, setHistoryLoading] = useState(false);
  const scrollArea = useRef<HTMLDivElement>(null), nearBottom = useRef(true), touching = useRef(false), submitted = useRef<{ id: string; text: string } | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null), lastSent = useRef<{ text: string; at: number } | null>(null);
  const dictation = useDictation(setInput), [keyboardHint, setKeyboardHint] = useState(false);
  const photos = useChatPhotos(), [sendingPhotos, setSendingPhotos] = useState(false), [photoNotice, setPhotoNotice] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const attach = (files: File[]) => { setPhotoNotice(photos.add(files) ? `Up to ${maxChatPhotos} photos per message.` : ""); };
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
      const photoIds = message.parts.flatMap((part) => part.type === "file" ? part.url.match(/^\/api\/photos\/([0-9a-f-]{36})$/i)?.[1] ?? [] : []);
      return { body: { ...common, message: { id: message.id, text: message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n"), photoIds } } };
    },
  }), [getPageContext]);
  const { messages, status, error, sendMessage, setMessages, clearError, addToolApprovalResponse, stop } = useChat<SiftUIMessage>({
    id: conversation?.id ?? "not-started", messages: (conversation?.messages ?? []) as SiftUIMessage[], transport, generateId: () => crypto.randomUUID(),
    // Batch stream deltas into ~20 renders/s; Markdown re-parses per render.
    throttle: 50,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onError: (error) => { setClientError(error.message); void reloadSaved(); },
    onFinish: () => {
      router.refresh(); void onHistory().catch(() => undefined);
      if (window.matchMedia("(min-width: 640px)").matches) composer.current?.focus();
      if (conversation) void api<Conversation>(`/api/conversations/${conversation.id}`).then((saved) => { onConversationChanged(saved); setServerBusy(saved.busy); setSavedError(saved.lastError ?? ""); }).catch(() => undefined);
    },
  });
  const streaming = status === "submitted" || status === "streaming", busy = streaming || serverBusy || loading || actionBusy || reloading || voice.busy;
  const voiceVisible = voice.busy || !!voice.error || !!voice.notice;
  // Messages present when this conversation opened render in place; only
  // ones added afterwards animate in.
  const [initialIds] = useState(() => new Set((conversation?.messages ?? []).map((message) => message.id)));
  const closePanel = useCallback(() => onOpenChange(false), [onOpenChange]);
  const approveRef = useRef<(id: string, approved: boolean) => Promise<void>>(async () => undefined);
  const onApproval = useCallback((id: string, approved: boolean) => { void approveRef.current(id, approved); }, []);
  const pendingApproval = messages.some((message) => message.parts.some((part) => isToolUIPart(part) && part.state === "approval-requested" && !part.approval.isAutomatic));
  const latestQuestionIndex = messages.findLastIndex((message) => message.role === "user");
  const compactCooking = docked && !showCookingHistory && !pendingApproval && latestQuestionIndex > 0;
  const visibleMessages = compactCooking ? messages.slice(latestQuestionIndex) : messages;
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
  }, [conversation, setMessages, clearError, router, onConversationChanged, setInput]);
  useEffect(() => subscribeVoiceConversation((saved) => {
    if (saved.id !== conversation?.id) return;
    setMessages(saved.messages as SiftUIMessage[]); setServerBusy(saved.busy); setSavedError(saved.lastError ?? ""); clearError(); setClientError("");
  }), [subscribeVoiceConversation, conversation?.id, setMessages, clearError]);
  useEffect(() => {
    if (!serverBusy || streaming) return;
    const timer = setInterval(() => { void reloadSaved(); }, 2500);
    return () => clearInterval(timer);
  }, [serverBusy, streaming, reloadSaved]);
  // Follow a streaming reply only while the reader is at the bottom and not
  // touching the list; otherwise every delta would yank them back down.
  useEffect(() => { if (nearBottom.current && !touching.current) scrollArea.current?.scrollTo({ top: messages.length ? scrollArea.current.scrollHeight : 0, behavior: "instant" }); }, [messages, streaming, open]);
  useEffect(() => {
    let changed = false, navigateTo: string | null = null;
    for (const message of messages) for (const part of message.parts) {
      if (!isToolUIPart(part) || part.state !== "output-available" || !pageEffects.has(part.type) || renderedMutations.current.has(part.toolCallId)) continue;
      renderedMutations.current.add(part.toolCallId);
      if (part.output && typeof part.output === "object" && "ok" in part.output && part.output.ok === true) {
        if (part.type === "tool-navigate" && "href" in part.output && typeof part.output.href === "string") {
          // The agent opened a page for the user. On a phone the sheet covers it.
          navigateTo = part.output.href;
          continue;
        }
        changed = true;
        if ("artifactId" in part.output && typeof part.output.artifactId === "string") {
          if (part.type === "tool-deleteArtifact" && window.location.pathname === `/artifacts/${part.output.artifactId}`) navigateTo = "/library";
          else window.dispatchEvent(new CustomEvent(ARTIFACT_CHANGED, { detail: { id: part.output.artifactId } }));
        }
      }
    }
    if (navigateTo) { router.push(navigateTo); if (!window.matchMedia("(min-width: 640px)").matches) onOpenChange(false); }
    else if (changed) router.refresh();
  }, [messages, router, onOpenChange]);
  async function submit() {
    const text = input.trim(); if ((!text && !photos.photos.length) || busy || pendingApproval || !conversation || sendingPhotos) return;
    dictation.stop();
    let photoIds: string[] = [];
    if (photos.photos.length) {
      // Uploads start on attach; usually they're done by the time Send is tapped.
      setSendingPhotos(true);
      try { photoIds = await photos.ready(); }
      catch { setPhotoNotice("A photo didn’t upload. Remove it or attach it again."); return; }
      finally { setSendingPhotos(false); }
    }
    const id = crypto.randomUUID(); submitted.current = { id, text }; lastSent.current = { text, at: Date.now() }; setInput(""); photos.clear(); setPhotoNotice(""); setSavedError(""); setClientError(""); setActionError(""); clearError(); nearBottom.current = true;
    await sendMessage({ id, role: "user", parts: [...photoIds.map((photoId) => ({ type: "file" as const, mediaType: "image/webp", url: `/api/photos/${photoId}` })), ...(text ? [{ type: "text" as const, text }] : [])] });
  }
  async function approve(id: string, approved: boolean) {
    if (voice.busy) return;
    setSavedError(""); setClientError(""); setActionError(""); clearError();
    await addToolApprovalResponse({ id, approved, options: { body: { approval: { id, approved } } } });
  }  useEffect(() => { approveRef.current = approve; });

  return <Sheet open={open} onOpenChange={onOpenChange} modal={!docked}>
    <Suspense fallback={null}><MobileNavigation hidden={open} voiceActive={voice.busy} /></Suspense>
    <VoiceLauncher voice={voice} hidden={open || cooking} disabled={busy || pendingApproval} replying={streaming || serverBusy} onDetails={onVoiceDetails} />
    <SheetContent id="sift-chat" side="bottom" showCloseButton={false} overlayClassName={styles.overlay} portalContainer={docked ? dockContainer : undefined} className={`${styles.panel} ${docked ? styles.docked : ""} ${docked && dockContainer ? styles.embedded : ""} gap-0 overflow-hidden border bg-background p-0`} style={docked && !dockContainer ? { width: dockWidth } : undefined}
      // Docked, Sift is part of the page: clicks elsewhere and Escape don't close it.
      onInteractOutside={(event) => { if (docked) event.preventDefault(); }}
      onEscapeKeyDown={(event) => { if (streaming) { event.preventDefault(); void stop(); } else if (docked) event.preventDefault(); }}
      onCloseAutoFocus={(event) => { if (window.matchMedia("(max-width: 639px)").matches) { event.preventDefault(); document.getElementById("mobile-sift-trigger")?.focus(); } }}
      onOpenAutoFocus={(event) => { event.preventDefault(); requestAnimationFrame(() => { nearBottom.current = true; setShowLatest(false); scrollArea.current?.scrollTo({ top: scrollArea.current.scrollHeight, behavior: "instant" }); if (!docked && window.matchMedia("(min-width: 640px)").matches) composer.current?.focus(); }); }}>
      {docked && !dockContainer && <DockResizer width={dockWidth} onResize={onDockResize} />}
      <SheetHeader className="flex-row items-center justify-between gap-3 border-b border-border/60 px-5 pb-3 pt-[max(.75rem,env(safe-area-inset-top))]">
        <SheetTitle className="sr-only">sift</SheetTitle>
        <SheetDescription className="sr-only">{pageLabel}</SheetDescription>
        <div className="flex min-w-0 items-center gap-1">
          <SiftMark className={docked && dockContainer ? "size-6 shrink-0" : "size-8 shrink-0"} />{docked && dockContainer && <span className="ml-2 whitespace-nowrap text-sm font-medium">Ask Sift</span>}

        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="icon" aria-label="New conversation" title="New conversation" disabled={busy} className="rounded-full text-muted-foreground" onClick={() => { setAction(null); void onNew(); }}><Plus className="size-[18px]" /></Button>

          <SheetClose asChild><Button variant="ghost" size="icon" aria-label="Close Sift" title={docked ? "Collapse sidebar" : "Close conversation"} className="rounded-full text-muted-foreground"><X className="size-[18px]" /></Button></SheetClose>
        </div>
      </SheetHeader>
        <div className="relative min-h-0 flex-1">
          <div ref={scrollArea} onTouchStart={() => { touching.current = true; }} onTouchEnd={() => { touching.current = false; }} onTouchCancel={() => { touching.current = false; }} onWheel={(event) => { if (event.deltaY < 0) { nearBottom.current = false; setShowLatest(true); } }} onScroll={(event) => { const target = event.currentTarget; nearBottom.current = target.scrollHeight - target.scrollTop - target.clientHeight < (touching.current ? 8 : 100); setShowLatest(!nearBottom.current); }} className={`${styles.conversation} h-full space-y-7 overflow-y-auto overscroll-contain px-5 pb-6 pt-6 sm:px-7`} role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation messages">
            {loading && !conversation ? <AssistantThinking label="Opening your conversation…" /> : !messages.length && <div className={`${styles.welcome} flex min-h-72 flex-col justify-center py-7 sm:min-h-80`}>
              <p className="mb-4 text-xs font-medium tracking-wide text-muted-foreground">A little help in the kitchen</p>
              <h2 className="text-[28px] font-semibold tracking-[-.045em]">{cooking ? "Right here with you." : "What sounds good?"}</h2><p className="mt-3 max-w-[340px] text-sm leading-6 text-muted-foreground">{cooking ? "A substitution, a technique, a little reassurance. Ask as you cook." : "Paste a recipe link, text or photo to save it. Or ask for ideas, swaps and plans."}</p>
              <div className="mt-7 grid grid-cols-2 gap-2">{(cooking ? [
                { icon: BookOpen, label: "Explain this step", prompt: "Walk me through my current cooking step.", recipePrompt: undefined },
                { icon: SlidersHorizontal, label: "Swap an ingredient", prompt: "Help me substitute an ingredient for this recipe." },
                { icon: Check, label: "Is it ready?", prompt: "What signs should I look for to know this step is done?" },
                { icon: ListChecks, label: "What’s next?", prompt: "What should I have ready for the next step?" },
              ] : [
                { icon: BookOpen, label: "Find a recipe", prompt: "What can I cook tonight?" },
                { icon: ListChecks, label: "Build a grocery list", prompt: "Help me build a grocery list from my recipes.", recipePrompt: "Make a grocery list for this recipe." },
                { icon: SlidersHorizontal, label: "Make a substitution", prompt: "Help me make a substitution in a recipe.", recipePrompt: "Suggest a substitution for this recipe." },
                { icon: CalendarDays, label: "Plan some meals", prompt: "Help me plan meals for this week." },
              ]).map(({ icon: Icon, label, prompt, recipePrompt }) => <button key={label} disabled={busy || !conversation} className="flex min-h-14 items-center gap-2.5 rounded-xl bg-muted/65 px-3.5 py-3 text-left text-xs leading-5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50" onClick={() => { setInput(recipePrompt && getPageContext().activeRecipeId ? recipePrompt : prompt); composer.current?.focus(); }}><Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>{label}</span></button>)}</div>
            </div>}
            {docked && latestQuestionIndex > 0 && <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" aria-expanded={showCookingHistory || pendingApproval} onClick={() => setShowCookingHistory((value) => !value)}>{showCookingHistory ? "Back to latest exchange" : "Show earlier messages"}</Button>}
            {visibleMessages.map((message) => <AssistantMessage key={message.id} message={message} busy={busy} animate={!initialIds.has(message.id)} streaming={streaming && message.role === "assistant" && message.id === messages.at(-1)?.id} liveArtifactReceipts={liveArtifactReceipts} onApproval={onApproval} onNavigate={closePanel} />)}
            {streaming && messages.at(-1)?.role === "user" && <div aria-label="Sift response" className="sift-response sift-enter"><span className="sr-only">Sift</span><AssistantActivity /></div>}
            {serverBusy && !streaming && <AssistantThinking label="Finishing the saved reply…" />}
            {(error || clientError || savedError) && <div role="alert" className="rounded-2xl border border-destructive/25 bg-destructive/5 p-4"><p className="text-sm leading-relaxed text-destructive">{error?.message || clientError || savedError}</p><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Check the saved results before sending another message.</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={reloading || streaming} onClick={() => { void reloadSaved(); }}><RefreshCw />Reload saved conversation</Button><Button size="sm" variant="ghost" onClick={onSettings}><Settings2 />Sift settings</Button></div></div>}
            {(loadError || actionError) && <p role="alert" className="text-sm text-destructive">{loadError || actionError}</p>}
            {conversation && !!(error || clientError || savedError) && <AssistantDetails conversation={conversation} showReceipts={!!(error || clientError || savedError)} onNavigate={() => onOpenChange(false)} />}
            {!conversation && !loading && loadError && <Button variant="outline" onClick={() => onOpenChange(true)}>Try again</Button>}
          </div>
          {showLatest && messages.length > 0 && <Button variant="outline" size="icon" aria-label="Jump to latest message" className="absolute bottom-3 left-1/2 size-9 -translate-x-1/2 rounded-full bg-background shadow-md" onClick={() => { nearBottom.current = true; setShowLatest(false); scrollArea.current?.scrollTo({ top: scrollArea.current.scrollHeight, behavior: "smooth" }); }}><ArrowDown className="size-4" /></Button>}
        </div>
        <div className="shrink-0 bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5">
          {voiceVisible && <div className="mb-3 flex items-center gap-2 rounded-2xl border border-border/70 bg-muted/35 p-2.5"><VoiceIndicator phase={voice.phase} small /><p role="status" className="min-w-0 flex-1 text-xs font-medium">{voiceLabels[voice.phase]}</p><Button variant="ghost" size="icon" aria-label="Voice controls" title="Voice controls" className="size-11 rounded-full" onClick={onVoiceDetails}><SlidersHorizontal className="size-4" /></Button>{voice.busy && <Button variant="ghost" size="icon" aria-label="End voice" title="End voice" className="size-11 rounded-full" disabled={voice.phase === "ending"} onClick={() => void voice.end()}><PhoneOff className="size-4" /></Button>}</div>}
          {!voice.busy && <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <div onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault(); }} onDrop={(event) => { const files = Array.from(event.dataTransfer.files); if (files.length) { event.preventDefault(); attach(files); } }} className="rounded-[22px] border border-border/80 bg-muted/55 px-2 pb-2 pt-1 transition-shadow focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/10">
              {photos.photos.length > 0 && <ul aria-label="Attached photos" className="flex gap-2 overflow-x-auto px-1.5 pb-1 pt-2">{photos.photos.map((photo, index) => <li key={photo.key} className="relative size-16 shrink-0">
                <Image src={photo.preview} alt={`Attached photo ${index + 1}`} fill unoptimized className={`rounded-xl object-cover ${photo.status === "uploading" ? "opacity-60" : ""}`} />
                {photo.status === "uploading" && <span role="status" aria-label={`Uploading photo ${index + 1}`} className="absolute inset-0 flex items-center justify-center"><LoaderCircle className="size-5 animate-spin text-white drop-shadow" /></span>}
                {photo.status === "error" && <span title={photo.error} className="absolute inset-0 flex items-center justify-center rounded-xl bg-destructive/70"><AlertCircle className="size-5 text-white" /></span>}
                <button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => photos.remove(photo.key)} className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-foreground text-background shadow ring-2 ring-background"><X className="size-3.5" /></button>
              </li>)}</ul>}
              <Textarea id="sift-composer" ref={composer} aria-label="Message Sift" disabled={!conversation && !loading} value={input} onChange={(event) => { if (!isSentEcho(input, event.target.value, lastSent.current)) setInput(event.target.value); }} maxLength={8000} rows={2} placeholder={photos.photos.length ? "Add a note, or just send…" : cooking ? "Ask Sift anything…" : "Ask Sift, or paste a recipe…"} onPaste={(event) => { const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/")); if (files.length) { event.preventDefault(); attach(files); } }} className="max-h-40 min-h-[68px] resize-none rounded-none border-0 bg-transparent px-3 py-3 text-base leading-6 shadow-none focus-visible:ring-0 sm:text-sm dark:bg-transparent" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia("(min-width: 640px)").matches) { event.preventDefault(); void submit(); } }} />
              <div className="flex min-h-11 flex-wrap items-center justify-between gap-1"><div className="flex w-full items-center justify-end gap-0.5"><Button type="button" variant="ghost" size="icon" aria-label={dictation.listening ? "Stop dictation" : "Dictate message"} aria-pressed={dictation.listening} title={dictation.listening ? "Stop dictation" : "Dictate (free)"} disabled={loading || !conversation} onClick={() => {
                if (dictation.listening) { dictation.stop(); return; }
                // Without the Web Speech API (e.g. some home-screen apps), the
                // keyboard's own dictation key is the free fallback.
                if (!dictation.supported) { setKeyboardHint(true); composer.current?.focus(); return; }
                setKeyboardHint(false); dictation.start(input);
              }} className={`rounded-full ${dictation.listening ? "bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive" : "text-muted-foreground"}`}>{dictation.listening ? <Square className="size-3.5 fill-current" /> : <Mic className="size-[18px]" />}</Button><Button type="button" variant="ghost" size="icon" aria-label="Talk to Sift" title="Live voice conversation (ElevenLabs)" disabled={busy || pendingApproval || !conversation || dictation.listening} onClick={() => void voice.start()} className="rounded-full text-muted-foreground"><AudioLines className="size-[18px]" /></Button>{streaming ? <Button type="button" size="icon" aria-label="Stop generating" title="Stop generating" className="size-10 rounded-full" onClick={() => void stop()}><Square className="size-3.5 fill-current" /></Button> : <Button type="submit" size="icon" aria-label="Send message" disabled={busy || pendingApproval || (!input.trim() && !photos.photos.length) || photos.failed || sendingPhotos || !conversation} className="size-10 rounded-full">{sendingPhotos ? <LoaderCircle className="size-[18px] animate-spin" /> : <ArrowUp className="size-[18px]" />}</Button>}</div></div>
            </div>
            {photoNotice && <p role="alert" className="mt-2.5 text-center text-[11px] leading-relaxed text-destructive">{photoNotice}</p>}
            {dictation.listening && <p role="status" className="mt-2.5 text-center text-[11px] leading-relaxed text-muted-foreground">Listening… tap stop when you’re done, then send.</p>}
            {dictation.error && <p role="alert" className="mt-2.5 text-center text-[11px] leading-relaxed text-destructive">{dictation.error}</p>}
            {keyboardHint && !dictation.error && <p className="mt-2.5 text-center text-[11px] leading-relaxed text-muted-foreground">Tap the microphone on your keyboard to dictate.</p>}
            {pendingApproval && <p className="mt-2.5 text-center text-[11px] leading-relaxed text-muted-foreground">Respond to the confirmation above to continue.</p>}
          </form>}
          <div className="mt-1 flex min-w-0 items-center justify-between gap-2" aria-label="Conversation controls">
          <DropdownMenu onOpenChange={(isOpen) => { if (isOpen) { setHistoryLoading(!history.length); void onHistory().catch(() => setActionError("Couldn’t load conversations. Try again.")).finally(() => setHistoryLoading(false)); } }}>
            <DropdownMenuTrigger asChild><Button variant="ghost" aria-label="Conversation history" title="Past conversations" disabled={busy} className="h-9 min-w-0 max-w-[calc(100%-84px)] justify-start gap-1.5 rounded-lg px-2 text-[11px] text-muted-foreground"><span className="truncate text-left">{conversation?.title ?? "Conversations"}</span><ChevronDown className="size-4 shrink-0" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-80 max-w-[calc(100vw-2rem)] rounded-2xl p-2">
              <DropdownMenuLabel className="px-3 pb-2 pt-2 text-xs font-medium text-muted-foreground">Past conversations</DropdownMenuLabel>
              <div className="max-h-[min(360px,50dvh)] overflow-y-auto">
                {historyLoading ? <p role="status" className="flex items-center gap-2 px-3 py-5 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Loading conversations…</p> : history.length ? history.map((item) => <DropdownMenuItem key={item.id} disabled={loading} onSelect={() => { setAction(null); void onLoad(item.id); }} className="min-h-14 gap-3 rounded-xl px-3 py-2.5"><History className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate text-sm">{item.title}</span><span className="mt-1 block text-[11px] text-muted-foreground">{new Date(item.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></span>{item.id === conversation?.id && <Check className="size-3.5 shrink-0" />}</DropdownMenuItem>) : <p className="px-3 py-5 text-xs text-muted-foreground">No past conversations yet.</p>}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
            <div className="flex shrink-0 items-center gap-0.5"><input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(event) => { attach(Array.from(event.target.files ?? [])); event.target.value = ""; }} /><Button type="button" variant="ghost" size="icon" aria-label="Attach photos" title="Attach photos" disabled={!conversation || photos.photos.length >= maxChatPhotos} onClick={() => photoInput.current?.click()} className="size-9 shrink-0 rounded-lg text-muted-foreground"><ImagePlus className="size-[18px]" /></Button><Button type="button" variant="ghost" size="icon" aria-label="Conversation settings" title="Conversation settings" disabled={!conversation || loading} className="size-9 shrink-0 rounded-lg text-muted-foreground" onClick={() => { setAction(null); setActionError(""); setConversationSettingsOpen(true); }}><Settings2 className="size-4" /></Button></div>
          </div>
        </div>
    </SheetContent>


    <Dialog open={conversationSettingsOpen} onOpenChange={(value) => { if (!actionBusy) { setConversationSettingsOpen(value); if (!value) setAction(null); } }}><DialogContent className="max-h-[85dvh] overflow-y-auto rounded-2xl sm:max-w-md"><DialogHeader><DialogTitle>Conversation settings</DialogTitle><DialogDescription className="truncate">{conversation?.title}</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <section className="space-y-1 border-b pb-4"><h3 className="text-xs text-muted-foreground">Model</h3>{conversation && <ModelSelector conversation={conversation} disabled={busy || pendingApproval} onBusy={setActionBusy} onChanged={(saved) => { setMessages(saved.messages as SiftUIMessage[]); setServerBusy(saved.busy); setSavedError(saved.lastError ?? ""); onConversationChanged(saved); }} />}</section>
        <MicrophoneSettings labeled disabled={loading || !conversation} voiceBusy={voice.busy} onEndVoice={voice.endForAudioSettings} />
        <div className="grid gap-1">
          <Button variant="ghost" className="justify-start" disabled={busy} onClick={() => { setAction(action === "rename" ? null : "rename"); setActionError(""); }}><Pencil />Rename conversation</Button>
        {action === "rename" && conversation && <form className="space-y-3 rounded-xl border p-4" onSubmit={async (event) => {
          event.preventDefault(); setActionError("");
          const title = String(new FormData(event.currentTarget).get("title")).trim(), previous = conversation;
          if (!title || actionBusy) return;
          setActionBusy(true);
          // Show the new title at once; restore it if the server refuses.
          onConversationChanged({ ...conversation, title }); setAction(null);
          try { onConversationChanged(await api<Conversation>(`/api/conversations/${conversation.id}`, { method: "PATCH", body: { title } })); void onHistory().catch(() => undefined); }
          catch (error) { onConversationChanged(previous); setActionError(error instanceof Error ? error.message : "Couldn’t rename this conversation."); }
          finally { setActionBusy(false); }
        }}><label className="block text-sm">Conversation title<Input name="title" defaultValue={conversation.title} required maxLength={120} className="mt-2" /></label><div className="flex gap-2"><Button size="sm" disabled={actionBusy} type="submit">Save title</Button><Button size="sm" variant="ghost" type="button" onClick={() => setAction(null)}>Cancel</Button></div></form>}
        {action === "delete" && conversation && <div className="space-y-3 rounded-xl border p-4"><p className="text-sm font-medium">Delete this conversation?</p><p className="text-xs leading-relaxed text-muted-foreground">Its messages will be removed. Recipes and notes you saved will stay in your cookbook.</p><div className="flex gap-2"><Button size="sm" disabled={actionBusy} onClick={async () => {
          setActionBusy(true); setActionError("");
          try { await api(`/api/conversations/${conversation.id}`, { method: "DELETE" }); onConversationChanged(null); await onHistory(); await onNew(); }
          catch (error) { setActionError(error instanceof Error ? error.message : "Couldn’t delete this conversation."); }
          finally { setActionBusy(false); }
        }}>Confirm delete</Button><Button size="sm" variant="ghost" disabled={actionBusy} onClick={() => setAction(null)}>Cancel</Button></div></div>}

          <Button variant="ghost" className="justify-start" onClick={() => { setConversationSettingsOpen(false); setUsageOpen(true); }}><ReceiptText />Conversation usage</Button>
          <Button variant="ghost" className="justify-start" onClick={() => { setConversationSettingsOpen(false); onSettings(); }}><Settings2 />Sift settings</Button>
          <Button variant="ghost" className="justify-start text-destructive hover:text-destructive" disabled={busy} onClick={() => { setAction(action === "delete" ? null : "delete"); setActionError(""); }}><Trash2 />Delete conversation</Button>
        </div>
        {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
      </div>
    </DialogContent></Dialog>
    <Dialog open={usageOpen} onOpenChange={setUsageOpen}><DialogContent className="max-h-[85dvh] overflow-y-auto rounded-3xl p-6 sm:max-w-lg"><DialogHeader><DialogTitle>Conversation usage</DialogTitle><DialogDescription>Model usage by turn. Voice is billed separately.</DialogDescription></DialogHeader>{conversation && <AiUsageDetails usage={conversation.usage} expanded />}</DialogContent></Dialog>
  </Sheet>;
}

/** Drag (or use arrow keys on) the sidebar's left edge to resize it. */
function DockResizer({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const clamp = (value: number) => Math.round(Math.min(dockWidthLimits.max, Math.max(dockWidthLimits.min, Math.min(value, window.innerWidth - 480))));
  return <div role="separator" aria-orientation="vertical" aria-label="Resize Sift sidebar" aria-valuemin={dockWidthLimits.min} aria-valuemax={dockWidthLimits.max} aria-valuenow={width} tabIndex={0} className={styles.resizer}
    onPointerDown={(event) => {
      event.preventDefault();
      const handle = event.currentTarget; handle.setPointerCapture(event.pointerId);
      document.documentElement.dataset.dockResizing = "";
      const move = (moveEvent: PointerEvent) => onResize(clamp(window.innerWidth - moveEvent.clientX));
      const up = () => { delete document.documentElement.dataset.dockResizing; handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up); };
      handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up); handle.addEventListener("pointercancel", up);
    }}
    onDoubleClick={() => onResize(dockWidthLimits.initial)}
    onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); onResize(clamp(width + (event.key === "ArrowLeft" ? 24 : -24))); } }} />;
}
