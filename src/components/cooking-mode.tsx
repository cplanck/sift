"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, Check, ChevronDown, Lightbulb, Minus, Plus, PanelRightClose, PanelRightOpen } from "lucide-react";
import { completeCookingStep, type CookingSessionDetail } from "@/domain/cooking";
import { scaleIngredient } from "@/domain/scaling";
import { stepIngredientKeys } from "@/domain/step-ingredients";
import type { RecipeSummary } from "@/domain/recipe";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable";
import type { CookingLayoutPreference } from "@/lib/cooking-layout";
import { useCookingLayout } from "./use-cooking-layout";
import { api } from "@/lib/client-http";
import { useAssistantPage, useAssistantVisibility, useCookingAssistantHost } from "./assistant-shell";
import { CookingWakeLock } from "./cooking-wake-lock";
import { OfflineRecipeSnapshot } from "./offline-recipe";
import { PhotoUpload } from "./photo-upload";
import { RecipeThumbnail } from "./recipe-thumbnail";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { cookingStepPresentation } from "@/domain/cooking-step-presentation";
import styles from "./cooking-mode.module.css";
import { CookingStepActions, CookingTimeline } from "./cooking-timeline";
import { CookingTimer } from "./cooking-timer";
import { CookingNoteView } from "./cooking-note";

type Progress = CookingSessionDetail["progress"];
function subscribeNetwork(listener: () => void) {
  window.addEventListener("online", listener); window.addEventListener("offline", listener);
  return () => { window.removeEventListener("online", listener); window.removeEventListener("offline", listener); };
}
const networkSnapshot = () => navigator.onLine;
const serverNetworkSnapshot = () => true;
export function CookingMode({ initialSession, initialLayout, initialNow, canEdit, coverPhotoId, coverSelection, coverImage, stockPhoto }: { initialSession: CookingSessionDetail; initialLayout: CookingLayoutPreference; initialNow: number; canEdit: boolean } & Pick<RecipeSummary, "coverPhotoId" | "coverSelection" | "coverImage" | "stockPhoto">) {
  const [session, setSession] = useState(initialSession), [previous, setPrevious] = useState(initialSession), [savedSession, setSavedSession] = useState(initialSession);
  const assistant = useAssistantVisibility();
  const { viewport, ...panelLayout } = useCookingLayout(initialLayout);
  const wide = viewport === "wide", phone = viewport === "phone";
  const assistantHost = useCookingAssistantHost();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const stage = useRef<HTMLElement>(null);
  const online = useSyncExternalStore(subscribeNetwork, networkSnapshot, serverNetworkSnapshot);
  const [localProgress, setLocalProgress] = useState(false);
  const [verifiedSessionId, setVerifiedSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [dialog, setDialog] = useState<"completed" | "abandoned" | null>(null);
  const saving = useRef(false), router = useRouter();
  if (previous !== initialSession) {
    setPrevious(initialSession);
    if (initialSession.id !== savedSession.id || initialSession.revision >= savedSession.revision) { setSavedSession(initialSession); setSession(initialSession); setLocalProgress(false); }
  }
  const { content } = session.version, active = session.status === "active", editable = active && canEdit && verifiedSessionId === session.id, progressEditable = editable && (!online || !localProgress);
  useEffect(() => {
    // Client navigation can restore a cached page. Read the saved revision before
    // enabling its actions so returning to Cook cannot overwrite newer progress.
    const controller = new AbortController();
    api<CookingSessionDetail>(`/api/cooking-sessions/${initialSession.id}`, { signal: controller.signal }).then((saved) => {
      if (controller.signal.aborted) return;
      setSession((current) => saved.revision >= current.revision ? saved : current);
      setSavedSession((current) => saved.revision >= current.revision ? saved : current);
    }).catch(() => { /* Offline cooks keep their last available snapshot. */ }).finally(() => {
      if (!controller.signal.aborted) setVerifiedSessionId(initialSession.id);
    });
    return () => controller.abort();
  }, [initialSession.id]);
  const steps = content.instructionSections.flatMap((section, sectionIndex) => section.steps.map((text, index) => ({ key: `${sectionIndex}:${index}`, section: section.name, text, illustrationKey: section.illustrationKeys?.[index] })));
  const current = steps[session.progress.currentStep] ?? steps[0];
  const stepIngredients = new Map(steps.map((step) => [step.key, stepIngredientKeys(content, step).map((key) => {
    const [sectionIndex, index] = key.split(":").map(Number);
    return { key, item: content.ingredientSections[sectionIndex].items[index] };
  })]));
  const scaled = (item: (typeof content.ingredientSections)[number]["items"][number]) => scaleIngredient(item, session.servings / content.servings);
  const currentIngredients = stepIngredients.get(current.key) ?? [];
  const presentation = cookingStepPresentation(current.text, current.section, current.illustrationKey);
  // Highlight an existing conditional tip without adding advice or repeating it.
  const stepTip = presentation.instruction.match(/(?:^|\s)(If\s[^.!?]+[.!?]?)$/)?.[1];
  const instruction = stepTip ? presentation.instruction.slice(0, -stepTip.length).trim() : presentation.instruction;
  const currentChecked = session.progress.checkedSteps.includes(current.key);
  useAssistantPage({ route: `/recipes/${session.recipeId}?cook=${session.id}`, activeRecipeId: session.recipeId, activeRecipeVersionId: session.recipeVersionId, activeCookingSessionId: session.id, title: `${content.title} · ${active ? "Cooking" : "Past cook"}` });
  useEffect(() => { stage.current?.scrollTo({ top: 0 }); }, [session.progress.currentStep]);
  function acceptSaved(saved: CookingSessionDetail) { setSavedSession(saved); setSession(saved); setLocalProgress(false); }
  async function reload() { const saved = await api<CookingSessionDetail>(`/api/cooking-sessions/${session.id}`); acceptSaved(saved); return saved; }
  async function saveProgress(progress: Progress, servings = session.servings) {
    if (saving.current || !progressEditable) return false;
    if (!online) { setSession({ ...session, progress, servings }); setLocalProgress(true); return true; }
    saving.current = true; setBusy(true); setError("");
    const before = session;
    setSession({ ...session, progress, servings });
    try { acceptSaved(await api<CookingSessionDetail>(`/api/cooking-sessions/${session.id}`, { method: "PATCH", body: { expectedRevision: session.revision, progress, servings } })); return true; }
    catch (error) { setSession(before); setError(error instanceof Error ? error.message : "Couldn’t save progress. Reconnect and try again."); await reload().catch(() => {}); return false; }
    finally { saving.current = false; setBusy(false); }
  }
  async function completeCurrentStep() {
    if (currentChecked) { toggle("checkedSteps", current.key); return; }
    const saved = await saveProgress(completeCookingStep(session.progress, steps.map((step) => step.key)));
    if (saved && session.progress.currentStep === steps.length - 1 && online && !localProgress) { setError(""); setDialog("completed"); }
  }
  function toggle(kind: "checkedIngredients" | "checkedSteps", key: string) {
    const checked = session.progress[kind];
    void saveProgress({ ...session.progress, [kind]: checked.includes(key) ? checked.filter((item) => item !== key) : [...checked, key] });
  }
  async function discard() {
    if (saving.current || !online || localProgress) return;
    saving.current = true; setBusy(true); setError("");
    try {
      await api(`/api/cooking-sessions/${session.id}/actions`, { body: { action: "discard", expectedRevision: session.revision } });
      setDialog(null); router.replace(`/recipes/${session.recipeId}`); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t discard this cook."); await reload().catch(() => {}); saving.current = false; setBusy(false); }
  }
  async function finish(form: HTMLFormElement) {
    if (saving.current || !dialog || !online || localProgress) return;
    saving.current = true; setBusy(true); setError("");
    const data = new FormData(form), rating = String(data.get("rating") ?? ""), notes = String(data.get("notes") ?? "").trim();
    try {
      acceptSaved(await api<CookingSessionDetail>(`/api/cooking-sessions/${session.id}/actions`, { body: { action: "finish", expectedRevision: session.revision, status: dialog, ...(rating ? { rating: Number(rating) } : {}), ...(notes ? { notes } : {}) } }));
      setDialog(null); router.replace(`/recipes/${session.recipeId}`); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t finish this cook."); await reload().catch(() => {}); }
    finally { saving.current = false; setBusy(false); }
  }
  const cookingActions = <CookingStepActions checked={currentChecked} last={session.progress.currentStep === steps.length - 1} disabled={!progressEditable || busy} canFinish={editable && !busy && online && !localProgress} onToggle={() => void completeCurrentStep()} onStop={editable ? () => { setError(""); setDialog("abandoned"); } : undefined} onFinish={() => { setDetailsOpen(false); setError(""); setDialog("completed"); }} />;
  const cookingTimeline = <CookingTimeline steps={steps} current={session.progress.currentStep} checkedSteps={session.progress.checkedSteps} disabled={!progressEditable || busy} onNavigate={(currentStep) => void saveProgress({ ...session.progress, currentStep })} actions={phone ? undefined : cookingActions} />;
  const detailsContent = <>
    <Tabs defaultValue="ingredients" className="min-w-0 gap-6 px-3 pb-5 sm:px-6 sm:pb-6"><TabsList className="h-auto w-full justify-start gap-0 overflow-x-auto rounded-none border-b border-border/70 bg-transparent p-0">{[["ingredients", "Ingredients"], ["steps", "All steps"], ["notes", "Cook notes"], ["photos", "Cook photos"]].map(([value, label]) => <TabsTrigger key={value} value={value} className="min-h-12 flex-none rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:text-sm lg:px-2.5 xl:px-4">{label}</TabsTrigger>)}</TabsList>
      <TabsContent value="ingredients"><div className="mb-6 flex flex-wrap items-center gap-3"><label htmlFor="cook-servings" className="text-sm text-muted-foreground">Servings for this cook</label><Button variant="outline" size="icon" aria-label="Fewer cooking servings" disabled={!progressEditable || busy || session.servings <= 1} onClick={() => saveProgress(session.progress, Math.max(1, session.servings - 1))}><Minus /></Button><Input key={`${session.revision}:${session.servings}`} id="cook-servings" type="number" min={0.125} max={1000} step="any" defaultValue={session.servings} disabled={!progressEditable || busy} className="w-20 text-center" onBlur={(event) => { const value = Number(event.target.value); if (value > 0 && value <= 1000 && value !== session.servings) void saveProgress(session.progress, value); else event.target.value = String(session.servings); }} /><Button variant="outline" size="icon" aria-label="More cooking servings" disabled={!progressEditable || busy || session.servings >= 1000} onClick={() => saveProgress(session.progress, Math.min(1000, session.servings + 1))}><Plus /></Button></div>
        {content.ingredientSections.map((section, sectionIndex) => <section key={sectionIndex} className="mb-7 max-w-3xl">{section.name && <h2 className="mb-3 text-sm font-semibold">{section.name}</h2>}<ul>{section.items.map((item, index) => { const key = `${sectionIndex}:${index}`, checked = session.progress.checkedIngredients.includes(key); return <li key={key}><label className="flex min-h-14 cursor-pointer items-start gap-4 rounded-xl px-2 py-4 hover:bg-muted/30"><input type="checkbox" checked={checked} disabled={!progressEditable || busy} onChange={() => toggle("checkedIngredients", key)} className="mt-1 size-5 shrink-0 accent-foreground" /><span className={`text-lg leading-relaxed ${checked ? "text-muted-foreground line-through" : ""}`}>{scaleIngredient(item, session.servings / content.servings)}</span></label></li>; })}</ul></section>)}
        {session.servings !== content.servings && <p className="text-xs text-muted-foreground">Scaled for this cook. Adjust seasoning and cooking times to suit.</p>}
      </TabsContent>
      <TabsContent value="steps"><ol className="max-w-3xl space-y-4">{steps.map((step, index) => <li key={step.key} className={`rounded-2xl border p-5 ${active && index === session.progress.currentStep ? "bg-muted/40" : ""}`}><label className="flex items-start gap-4"><input type="checkbox" checked={session.progress.checkedSteps.includes(step.key)} disabled={!progressEditable || busy} onChange={() => toggle("checkedSteps", step.key)} className="mt-1 size-5 shrink-0 accent-foreground" /><span><span className="mb-2 block text-xs text-muted-foreground">Step {index + 1}{step.section ? ` · ${step.section}` : ""}</span><span className="text-lg leading-relaxed">{step.text}</span>{(stepIngredients.get(step.key)?.length ?? 0) > 0 && <span className="mt-2 block text-sm leading-relaxed text-muted-foreground">{stepIngredients.get(step.key)!.map(({ item }) => scaled(item)).join(" · ")}</span>}</span></label>{editable && index !== session.progress.currentStep && <Button variant="ghost" size="sm" className="ml-7 mt-3" disabled={busy} onClick={() => saveProgress({ ...session.progress, currentStep: index })}>Go to step {index + 1}</Button>}</li>)}</ol></TabsContent>
      <TabsContent value="notes"><section className="max-w-2xl"><h2 className="text-xl font-medium">Notes from this cook.</h2><p className="mt-2 text-sm text-muted-foreground">Observations stay with this session. Your recipe remains unchanged.</p>{canEdit && <form className="my-6 space-y-3" onSubmit={async (event) => { event.preventDefault(); if (saving.current || !online) return; const form = event.currentTarget; saving.current = true; setBusy(true); setError(""); try { await api(`/api/cooking-sessions/${session.id}/actions`, { body: { action: "note", body: new FormData(form).get("body") } }); await reload(); form.reset(); } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t save this note."); } finally { saving.current = false; setBusy(false); } }}><Textarea name="body" aria-label="Cooking note" required maxLength={5000} placeholder="What worked? What would you try next time?" className="min-h-28" /><Button disabled={busy || !online}>Add cooking note</Button></form>}<div className="mt-6 space-y-4">{session.notes.map((note) => <article key={note.id} className="rounded-2xl border p-5"><CookingNoteView note={note} /><p className="mt-3 text-xs text-muted-foreground">{new Date(note.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</p></article>)}</div></section></TabsContent>
      <TabsContent value="photos"><section className="max-w-3xl space-y-6"><div><h2 className="text-xl font-medium">Photos from this cook.</h2><p className="mt-2 text-sm text-muted-foreground">Private observations, separate from the recipe’s photos and shared cover.</p></div>{canEdit && online && <PhotoUpload purpose="cooking" sessionId={session.id} onUploaded={async () => { await reload(); }} />}{session.photos.length > 0 && <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{session.photos.map((photo, index) => <RecipeThumbnail key={photo.id} photoId={photo.id} alt={`${content.title}, cook photo ${index + 1}`} className="aspect-square w-full" />)}</div>}</section></TabsContent>
    </Tabs>
    <div className={styles.sessionUtilities}><span role="status">{busy ? "Saving…" : online && !localProgress ? "Progress saved" : "Changes stay on this screen"}</span><CookingWakeLock /></div>
{editable && <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-border/70 pt-6 sm:mt-12"><Button className="min-h-12 rounded-full px-6" onClick={() => { setDetailsOpen(false); setError(""); setDialog("completed"); }} disabled={busy || !online || localProgress}><Check />Finish cooking</Button></div>}
  </>;
  return <main id="main" className={styles.page} data-active={active}>
    <OfflineRecipeSnapshot snapshot={{ recipeId: session.recipeId, versionId: session.recipeVersionId, versionNumber: session.version.number, content, coverPhotoId, cooking: { id: session.id, status: savedSession.status, servings: savedSession.servings, ...savedSession.progress } }} />
    {!active && <><h1 className="mt-8 text-3xl font-semibold tracking-tight">{content.title}</h1><p className="mb-6 mt-3 text-xs text-muted-foreground">{new Date(session.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} · Version {session.version.number}{session.rating != null ? ` · ${session.rating}/5` : ""}</p></>}
    {!canEdit && active && <p className="mb-6 rounded-xl border p-4 text-sm text-muted-foreground">You’re viewing a cook started by someone else in this cookbook. Only its starter can change progress.</p>}
    {!active && <div className="mb-8 rounded-2xl border bg-muted/30 p-5"><p className="text-sm font-medium">{session.status === "completed" ? "Another one for the cookbook." : "Saved for your cooking history."}</p><CookingTimer startedAt={session.startedAt} finishedAt={session.finishedAt} initialNow={initialNow} />{session.summary && <p className="mt-3 whitespace-pre-wrap leading-relaxed">{session.summary}</p>}<p className="mt-3 text-xs text-muted-foreground">This cook keeps the recipe exactly as it was when you started.</p></div>}
    {(!online || localProgress) && <div role="status" className="mb-5 space-y-3 rounded-xl border bg-muted/30 p-4 text-sm"><p>{!online ? "You’re offline. Checkoffs on this screen won’t save or sync. Notes, photos, and finishing need a connection." : "You’re back online. Your local checkoffs haven’t been saved. Reload your saved progress to continue."}</p>{online && localProgress && <Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await reload(); } catch { setError("Couldn’t reload saved progress. Check your connection and try again."); } finally { setBusy(false); } }}>Reload saved progress</Button>}</div>}
    {error && <p role="alert" className="mb-5 rounded-xl border p-4 text-sm text-destructive">{error}</p>}
    {active && <ResizablePanelGroup id="cooking-workspace" {...panelLayout} orientation={phone ? "vertical" : "horizontal"} resizeTargetMinimumSize={{ coarse: 36, fine: 12 }} className={styles.workspace} style={{ overflow: "visible" }}>
      <ResizablePanel id="cooking-steps" defaultSize={phone ? 94 : "21%"} minSize={phone ? 94 : 170} maxSize={phone ? 94 : "36%"} className={styles.railPanel} style={{ overflow: "hidden" }}>
      <aside className={styles.stepRail} aria-label="Recipe and step navigation">
        <Link href={`/recipes/${session.recipeId}`} className={styles.recipeLink}><ArrowLeft size={19} /><span>{content.title}</span></Link>
        <RecipeThumbnail recipeId={session.recipeId} photoId={coverPhotoId} coverSelection={coverSelection} coverImage={coverImage} stockPhoto={stockPhoto} title={content.title} tags={content.tags} alt={content.title} eager sizes="(max-width: 639px) 64px, 280px" className={styles.recipePhoto} />
        <div className={styles.recipeUtilities}><CookingTimer startedAt={session.startedAt} finishedAt={session.finishedAt} initialNow={initialNow} /><button className={styles.fullRecipe} onClick={() => setDetailsOpen(true)}><BookOpen size={16} />Details</button></div>
      {!phone && cookingTimeline}
      </aside>
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize steps sidebar" disabled={phone} className={`${styles.resizeHandle} ${phone ? styles.hiddenHandle : ""}`} />
      <ResizablePanel id="cooking-instruction" minSize={phone ? 140 : 260} className={styles.centerPanel} style={{ overflow: "hidden" }}>
      <div className={styles.center}>
      <section ref={stage} tabIndex={0} aria-label="Current cooking step" className={styles.stage}>
        {currentChecked && <span className={styles.completedLabel}><Check size={13} />Completed</span>}
        <p className="sr-only" role="status">Step {session.progress.currentStep + 1} of {steps.length}{presentation.heading ? `: ${presentation.heading}` : ""}</p>
        <div className={styles.body}>
          <div key={current.key} className={styles.stepCopy}>
            {presentation.heading ? <>
              <h1 className={styles.heading}>{presentation.heading}</h1>
              {instruction && <p className={styles.instruction}>{instruction}</p>}
            </> : <h1 className={`${styles.instruction} ${styles.standaloneInstruction}`}>{instruction || presentation.instruction}</h1>}
          </div>
        </div>
        {currentIngredients.length > 0 && <details key={`ingredients:${current.key}`} open={currentIngredients.length <= 4} aria-label="Ingredients for this step" className={styles.ingredients}>
          <summary><span>For this step <small>{currentIngredients.length} {currentIngredients.length === 1 ? "ingredient" : "ingredients"} · {session.servings} servings</small></span><ChevronDown size={15} /></summary>
          <ul>{currentIngredients.map(({ key, item }) => { const checked = session.progress.checkedIngredients.includes(key); return <li key={key}><label><input type="checkbox" checked={checked} disabled={!progressEditable || busy} onChange={() => toggle("checkedIngredients", key)} /><span className={checked ? "text-muted-foreground line-through" : ""}>{scaled(item)}</span></label></li>; })}</ul>
        </details>}
        {stepTip && instruction && <aside className={styles.tip}><Lightbulb size={21} /><div><h2>Recipe tip</h2><p>{stepTip}</p></div></aside>}

      </section>

      </div>
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize Sift sidebar" disabled={!wide} className={`${styles.resizeHandle} ${!wide ? styles.hiddenHandle : ""}`} />
      <ResizablePanel id="cooking-assistant" defaultSize={wide ? "29%" : 0} minSize={wide ? 260 : 0} maxSize={wide ? "45%" : 0} className={styles.toolsPanel} style={{ overflow: "visible" }}>
      <aside id="cooking-tools" className={styles.tools} data-assistant-open={assistant.open} aria-label="Sift assistant">
        <div className={styles.assistantHeading}><h2>Ask Sift</h2><Button variant="ghost" size="sm" aria-expanded={assistant.open} aria-controls="sift-chat" onClick={assistant.toggle}>{assistant.open ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}{assistant.open ? "Hide Sift" : "Show Sift"}</Button></div>
        <div ref={assistantHost} className={styles.assistantHost} />
      </aside>
      </ResizablePanel>
    </ResizablePanelGroup>}
    {active && phone && <div className={styles.mobileActions}>{cookingTimeline}{cookingActions}</div>}
    {active && <footer className={styles.footer}><div><Button variant="outline" className={styles.toolsToggle} aria-controls="sift-chat" aria-expanded={assistant.open} onClick={assistant.toggle}><PanelRightOpen size={16} />Ask Sift</Button></div></footer>}
    {active ? <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}><DialogContent className={styles.detailsDialog}><DialogHeader><DialogTitle>Ingredients &amp; details</DialogTitle><DialogDescription>{content.title} · {session.servings} servings</DialogDescription></DialogHeader><div className={styles.detailsScroll}>{detailsContent}</div></DialogContent></Dialog> : <section className={styles.details}>{detailsContent}</section>}
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open && !busy) setDialog(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{dialog === "completed" ? "How did it go?" : "Stop cooking?"}</DialogTitle><DialogDescription>{dialog === "completed" ? "Anything to remember for next time? Add as much or as little as you like. Sift will organize your notes after you finish." : `Save this cook to your history, or delete it.${session.notes.length || session.photos.length ? ` Deleting removes its ${[session.notes.length ? `${session.notes.length} note${session.notes.length === 1 ? "" : "s"}` : "", session.photos.length ? `${session.photos.length} photo${session.photos.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ")}.` : ""}`}</DialogDescription></DialogHeader><form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void finish(event.currentTarget); }}>{dialog === "abandoned" ? <details className="group"><summary className="cursor-pointer py-2 text-sm text-muted-foreground hover:text-foreground">Add notes (optional)</summary><div className="mt-3 space-y-3"><label className="block text-sm">Notes from this cook (optional)<Textarea name="notes" maxLength={20000} className="mt-2 min-h-40" placeholder="Tell us how it went—what you changed, what worked, what you’d do differently. No need to organize your thoughts." /></label><p className="text-xs leading-relaxed text-muted-foreground">Saved with this cook. Sift tidies the wording in the background and keeps your original notes.</p></div></details> : <><label className="block text-sm">Notes from this cook (optional)<Textarea name="notes" maxLength={20000} className="mt-2 min-h-40" placeholder="Tell us how it went—what you changed, what worked, what you’d do differently. No need to organize your thoughts." /></label><p className="text-xs leading-relaxed text-muted-foreground">Saved with this cook. Sift tidies the wording in the background and keeps your original notes.</p></>}{dialog === "completed" && <label className="block text-sm">Rating (optional)<select name="rating" className="mt-2 h-11 w-full rounded-xl border bg-background px-3"><option value="">No rating</option>{[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating} / 5</option>)}</select></label>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter className="gap-2 sm:justify-between"><Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>Keep cooking</Button><div className="flex flex-col-reverse gap-2 sm:flex-row">{dialog === "abandoned" && <Button type="button" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy || !online || localProgress} onClick={() => void discard()}>Delete cook</Button>}<Button type="submit" disabled={busy || !online || localProgress}>{dialog === "completed" ? "Save completed cook" : "Save cook"}</Button></div></DialogFooter></form></DialogContent></Dialog>
  </main>;
}
