"use client";
import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, MessageCircle, Mic, Minus, Plus } from "lucide-react";
import type { CookingSessionDetail } from "@/domain/cooking";
import { scaleIngredient } from "@/domain/scaling";
import { api } from "@/lib/client-http";
import { useAssistantPage, useOpenSift, useSiftVoice } from "./assistant-shell";
import { CookingWakeLock } from "./cooking-wake-lock";
import { OfflineRecipeSnapshot } from "./offline-recipe";
import { PhotoUpload } from "./photo-upload";
import { RecipeThumbnail } from "./recipe-thumbnail";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

type Progress = CookingSessionDetail["progress"];
function subscribeNetwork(listener: () => void) {
  window.addEventListener("online", listener); window.addEventListener("offline", listener);
  return () => { window.removeEventListener("online", listener); window.removeEventListener("offline", listener); };
}
const networkSnapshot = () => navigator.onLine;
const serverNetworkSnapshot = () => true;
export function CookingMode({ initialSession, canEdit, coverPhotoId }: { initialSession: CookingSessionDetail; canEdit: boolean; coverPhotoId: string | null }) {
  const [session, setSession] = useState(initialSession), [previous, setPrevious] = useState(initialSession), [savedSession, setSavedSession] = useState(initialSession);
  const online = useSyncExternalStore(subscribeNetwork, networkSnapshot, serverNetworkSnapshot);
  const [localProgress, setLocalProgress] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [dialog, setDialog] = useState<"completed" | "abandoned" | null>(null);
  const saving = useRef(false), router = useRouter(), openSift = useOpenSift(), voice = useSiftVoice();
  if (previous !== initialSession) { setPrevious(initialSession); setSavedSession(initialSession); setSession(initialSession); setLocalProgress(false); }
  const { content } = session.version, active = session.status === "active", editable = active && canEdit, progressEditable = editable && (!online || !localProgress);
  const steps = content.instructionSections.flatMap((section, sectionIndex) => section.steps.map((text, index) => ({ key: `${sectionIndex}:${index}`, section: section.name, text })));
  const current = steps[session.progress.currentStep] ?? steps[0];
  useAssistantPage({ route: `/recipes/${session.recipeId}?cook=${session.id}`, activeRecipeId: session.recipeId, activeRecipeVersionId: session.recipeVersionId, activeCookingSessionId: session.id, title: `${content.title} · ${active ? "Cooking" : "Past cook"}` });
  function acceptSaved(saved: CookingSessionDetail) { setSavedSession(saved); setSession(saved); setLocalProgress(false); }
  async function reload() { const saved = await api<CookingSessionDetail>(`/api/cooking-sessions/${session.id}`); acceptSaved(saved); return saved; }
  async function saveProgress(progress: Progress, servings = session.servings) {
    if (saving.current || !progressEditable) return;
    if (!online) { setSession({ ...session, progress, servings }); setLocalProgress(true); return; }
    saving.current = true; setBusy(true); setError("");
    const before = session;
    setSession({ ...session, progress, servings });
    try { acceptSaved(await api<CookingSessionDetail>(`/api/cooking-sessions/${session.id}`, { method: "PATCH", body: { expectedRevision: session.revision, progress, servings } })); }
    catch (error) { setSession(before); setError(error instanceof Error ? error.message : "Couldn’t save progress. Reconnect and try again."); await reload().catch(() => {}); }
    finally { saving.current = false; setBusy(false); }
  }
  function toggle(kind: "checkedIngredients" | "checkedSteps", key: string) {
    const checked = session.progress[kind];
    void saveProgress({ ...session.progress, [kind]: checked.includes(key) ? checked.filter((item) => item !== key) : [...checked, key] });
  }
  async function finish(form: HTMLFormElement) {
    if (saving.current || !dialog || !online || localProgress) return;
    saving.current = true; setBusy(true); setError("");
    const data = new FormData(form), rating = String(data.get("rating") ?? ""), summary = String(data.get("summary") ?? "").trim();
    try {
      acceptSaved(await api<CookingSessionDetail>(`/api/cooking-sessions/${session.id}/actions`, { body: { action: "finish", expectedRevision: session.revision, status: dialog, ...(rating ? { rating: Number(rating) } : {}), ...(summary ? { summary } : {}) } }));
      setDialog(null); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t finish this cook."); await reload().catch(() => {}); }
    finally { saving.current = false; setBusy(false); }
  }
  return <main id="main" className={`page-width max-w-5xl py-6 sm:py-10 ${voice?.busy || voice?.error || voice?.notice ? "pb-64 sm:pb-64" : "pb-28 sm:pb-28"}`}>
    <OfflineRecipeSnapshot snapshot={{ recipeId: session.recipeId, versionId: session.recipeVersionId, versionNumber: session.version.number, content, coverPhotoId, cooking: { id: session.id, status: savedSession.status, servings: savedSession.servings, ...savedSession.progress } }} />
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><Link href={`/recipes/${session.recipeId}`} className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><ArrowLeft size={16} />Back to recipe</Link>{active && <CookingWakeLock />}</div>
    <div className="mb-8 flex flex-wrap items-start justify-between gap-5"><div><p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">{active ? "Cooking now" : session.status === "completed" ? "Cook completed" : "Cook ended early"} · Version {session.version.number}</p><h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{content.title}</h1><p className="mt-3 text-sm text-muted-foreground">{new Date(session.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} · {session.servings} servings{session.rating != null ? ` · ${session.rating}/5` : ""}</p></div>{openSift && <div className="flex flex-wrap gap-2">{voice && active && <Button disabled={!online || localProgress || voice.busy} onClick={() => void voice.start()}><Mic />{voice.busy ? "Voice is on" : "Talk to Sift"}</Button>}<Button variant="outline" onClick={openSift}><MessageCircle />Ask Sift</Button></div>}</div>
    {!canEdit && active && <p className="mb-6 rounded-xl border p-4 text-sm text-muted-foreground">You’re viewing a cook started by someone else in this cookbook. Only its starter can change progress.</p>}
    {!active && <div className="mb-8 rounded-2xl border bg-muted/30 p-5"><p className="text-sm font-medium">{session.status === "completed" ? "Another one for the cookbook." : "Saved for your cooking history."}</p>{session.summary && <p className="mt-3 whitespace-pre-wrap leading-relaxed">{session.summary}</p>}<p className="mt-3 text-xs text-muted-foreground">This cook keeps the recipe exactly as it was when you started.</p></div>}
    {(!online || localProgress) && <div role="status" className="mb-5 space-y-3 rounded-xl border bg-muted/30 p-4 text-sm"><p>{!online ? "You’re offline. Checkoffs on this screen won’t save or sync. Notes, photos, and finishing need a connection." : "You’re back online. Your local checkoffs haven’t been saved. Reload your saved progress to continue."}</p>{online && localProgress && <Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await reload(); } catch { setError("Couldn’t reload saved progress. Check your connection and try again."); } finally { setBusy(false); } }}>Reload saved progress</Button>}</div>}
    {error && <p role="alert" className="mb-5 rounded-xl border p-4 text-sm text-destructive">{error}</p>}
    {active && <section aria-label="Current cooking step" className="mb-8 rounded-2xl border bg-muted/30 p-6 sm:p-9">
      <div className="mb-5 flex items-center justify-between gap-4"><p className="text-sm font-medium text-muted-foreground">Step {session.progress.currentStep + 1} of {steps.length}{current.section ? ` · ${current.section}` : ""}</p>{session.progress.checkedSteps.includes(current.key) && <Check aria-label="Step completed" className="size-5" />}</div>
      <p className="max-w-3xl text-2xl font-medium leading-relaxed tracking-tight sm:text-3xl">{current.text}</p>
      <div className="mt-7 flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2"><Button variant="outline" aria-label="Previous step" disabled={!progressEditable || busy || session.progress.currentStep === 0} onClick={() => saveProgress({ ...session.progress, currentStep: session.progress.currentStep - 1 })}><ArrowLeft /><span className="hidden sm:inline">Previous</span></Button><Button variant="outline" aria-label="Next step" disabled={!progressEditable || busy || session.progress.currentStep >= steps.length - 1} onClick={() => saveProgress({ ...session.progress, currentStep: session.progress.currentStep + 1 })}><span>Next</span><ArrowRight /></Button></div><Button variant={session.progress.checkedSteps.includes(current.key) ? "secondary" : "default"} disabled={!progressEditable || busy} onClick={() => toggle("checkedSteps", current.key)}><Check />{session.progress.checkedSteps.includes(current.key) ? "Mark step unfinished" : "Mark step done"}</Button></div>
    </section>}
    <Tabs defaultValue="ingredients" className="gap-6"><TabsList className="h-auto w-full justify-start overflow-x-auto border-b bg-transparent p-0">{[["ingredients", "Ingredients"], ["steps", "All steps"], ["notes", "Cook notes"], ["photos", "Cook photos"]].map(([value, label]) => <TabsTrigger key={value} value={value} className="min-h-12 flex-none rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:px-5">{label}</TabsTrigger>)}</TabsList>
      <TabsContent value="ingredients"><div className="mb-6 flex flex-wrap items-center gap-3"><label htmlFor="cook-servings" className="text-sm text-muted-foreground">Servings for this cook</label><Button variant="outline" size="icon" aria-label="Fewer cooking servings" disabled={!progressEditable || busy || session.servings <= 1} onClick={() => saveProgress(session.progress, Math.max(1, session.servings - 1))}><Minus /></Button><Input key={`${session.revision}:${session.servings}`} id="cook-servings" type="number" min={0.125} max={1000} step="any" defaultValue={session.servings} disabled={!progressEditable || busy} className="w-20 text-center" onBlur={(event) => { const value = Number(event.target.value); if (value > 0 && value <= 1000 && value !== session.servings) void saveProgress(session.progress, value); else event.target.value = String(session.servings); }} /><Button variant="outline" size="icon" aria-label="More cooking servings" disabled={!progressEditable || busy || session.servings >= 1000} onClick={() => saveProgress(session.progress, Math.min(1000, session.servings + 1))}><Plus /></Button></div>
        {content.ingredientSections.map((section, sectionIndex) => <section key={sectionIndex} className="mb-7 max-w-3xl">{section.name && <h2 className="mb-3 text-sm font-semibold">{section.name}</h2>}<ul>{section.items.map((item, index) => { const key = `${sectionIndex}:${index}`, checked = session.progress.checkedIngredients.includes(key); return <li key={key}><label className="flex min-h-14 cursor-pointer items-start gap-4 rounded-xl px-2 py-4 hover:bg-muted/30"><input type="checkbox" checked={checked} disabled={!progressEditable || busy} onChange={() => toggle("checkedIngredients", key)} className="mt-1 size-5 shrink-0 accent-foreground" /><span className={`text-lg leading-relaxed ${checked ? "text-muted-foreground line-through" : ""}`}>{scaleIngredient(item, session.servings / content.servings)}</span></label></li>; })}</ul></section>)}
        {session.servings !== content.servings && <p className="text-xs text-muted-foreground">Scaled for this cook. Adjust seasoning and cooking times to suit.</p>}
      </TabsContent>
      <TabsContent value="steps"><ol className="max-w-3xl space-y-4">{steps.map((step, index) => <li key={step.key} className={`rounded-2xl border p-5 ${active && index === session.progress.currentStep ? "bg-muted/40" : ""}`}><label className="flex items-start gap-4"><input type="checkbox" checked={session.progress.checkedSteps.includes(step.key)} disabled={!progressEditable || busy} onChange={() => toggle("checkedSteps", step.key)} className="mt-1 size-5 shrink-0 accent-foreground" /><span><span className="mb-2 block text-xs text-muted-foreground">Step {index + 1}{step.section ? ` · ${step.section}` : ""}</span><span className="text-lg leading-relaxed">{step.text}</span></span></label>{editable && index !== session.progress.currentStep && <Button variant="ghost" size="sm" className="ml-7 mt-3" disabled={busy} onClick={() => saveProgress({ ...session.progress, currentStep: index })}>Go to step {index + 1}</Button>}</li>)}</ol></TabsContent>
      <TabsContent value="notes"><section className="max-w-2xl"><h2 className="text-xl font-medium">Notes from this cook.</h2><p className="mt-2 text-sm text-muted-foreground">Observations stay with this session. Your recipe remains unchanged.</p>{canEdit && <form className="my-6 space-y-3" onSubmit={async (event) => { event.preventDefault(); if (saving.current || !online) return; const form = event.currentTarget; saving.current = true; setBusy(true); setError(""); try { await api(`/api/cooking-sessions/${session.id}/actions`, { body: { action: "note", body: new FormData(form).get("body") } }); await reload(); form.reset(); } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t save this note."); } finally { saving.current = false; setBusy(false); } }}><Textarea name="body" aria-label="Cooking note" required maxLength={5000} placeholder="What worked? What would you try next time?" className="min-h-28" /><Button disabled={busy || !online}>Add cooking note</Button></form>}<div className="mt-6 space-y-4">{session.notes.map((note) => <article key={note.id} className="rounded-2xl border p-5"><p className="whitespace-pre-wrap leading-relaxed">{note.body}</p><p className="mt-3 text-xs text-muted-foreground">{new Date(note.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</p></article>)}</div></section></TabsContent>
      <TabsContent value="photos"><section className="max-w-3xl space-y-6"><div><h2 className="text-xl font-medium">Photos from this cook.</h2><p className="mt-2 text-sm text-muted-foreground">Private observations, separate from the recipe’s photos and shared cover.</p></div>{canEdit && online && <PhotoUpload purpose="cooking" sessionId={session.id} onUploaded={async () => { await reload(); }} />}{session.photos.length > 0 && <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{session.photos.map((photo, index) => <RecipeThumbnail key={photo.id} photoId={photo.id} alt={`${content.title}, cook photo ${index + 1}`} className="aspect-square w-full" />)}</div>}</section></TabsContent>
    </Tabs>
    {editable && <div className="mt-10 flex flex-wrap items-center gap-3 border-t pt-6"><Button onClick={() => { setError(""); setDialog("completed"); }} disabled={busy || !online || localProgress}><Check />Finish cooking</Button><Button variant="ghost" onClick={() => { setError(""); setDialog("abandoned"); }} disabled={busy || !online || localProgress}>End cook early</Button><p className="text-xs text-muted-foreground">{online && !localProgress ? "Progress saves as you go." : "Offline changes stay on this screen."}</p></div>}
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open && !busy) setDialog(null); }}><DialogContent><DialogHeader><DialogTitle>{dialog === "completed" ? "How did it go?" : "End this cook early?"}</DialogTitle><DialogDescription>{dialog === "completed" ? "Save this cook to your history. A rating and summary are optional." : "Your progress, notes, and photos stay in cooking history."}</DialogDescription></DialogHeader><form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void finish(event.currentTarget); }}>{dialog === "completed" && <label className="block text-sm">Rating (optional)<select name="rating" className="mt-2 h-11 w-full rounded-xl border bg-background px-3"><option value="">No rating</option>{[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating} / 5</option>)}</select></label>}<label className="block text-sm">Summary (optional)<Textarea name="summary" maxLength={5000} className="mt-2" placeholder="One to make again…" /></label>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>Keep cooking</Button><Button type="submit" disabled={busy || !online || localProgress}>{dialog === "completed" ? "Save completed cook" : "End this cook"}</Button></DialogFooter></form></DialogContent></Dialog>
  </main>;
}
