"use client";
import Image from "next/image";
import Link from "next/link";
import { memo, useEffect, useRef, useState } from "react";
import { ArrowUpRight, BookOpen, CalendarDays, Check, ChefHat, ChevronDown, ChevronRight, Copy, Globe, Heart, Link2, ListChecks, PencilLine, Search } from "lucide-react";
import { isToolUIPart } from "ai";
import type { SiftUIMessage } from "@/ai/assistant-runtime";
import { Button } from "./ui/button";
import { ArtifactCard, artifactPreviewSchema } from "./artifact-card";
import { AssistantMarkdown } from "./assistant-markdown";
import { AssistantActivity } from "./assistant-thinking";
import { SiftMark } from "./brand";

const toolLabels: Record<string, string> = {
  listArtifacts: "Finding your lists and plans", getArtifact: "Reading your list or plan", createGroceryList: "Making your grocery list", deriveGroceryList: "Gathering recipe ingredients", addGroceryItems: "Adding grocery items", removeGroceryItem: "Removing an item", setGroceryItemChecked: "Updating your checklist", createMealPlan: "Making your meal plan", addMealPlanEntry: "Adding a meal", removeMealPlanEntry: "Removing a meal",
  startCookingSession: "Starting your cook", getCookingSession: "Reading this cook", updateCookingProgress: "Saving cooking progress", finishCookingSession: "Finishing your cook", abandonCookingSession: "Ending your cook", addCookingSessionNote: "Saving your cooking note", listCookingHistory: "Reading cooking history", searchRecipes: "Looking through your cookbook", getRecipe: "Reading the recipe", createRecipe: "Saving a recipe", updateRecipe: "Updating the recipe", archiveRecipe: "Archiving the recipe", restoreArchivedRecipe: "Returning the recipe to your Library", restoreRecipeVersion: "Restoring a version", listRecipeVersions: "Reading version history", listRecipeNotes: "Reading recipe notes", addRecipeNote: "Saving your observation", setRecipeFavorite: "Updating your favorites",
  updateMealPlanEntry: "Updating a meal", updateGroceryItem: "Editing an item", clearCheckedGroceryItems: "Clearing checked items", renameArtifact: "Renaming", deleteArtifact: "Deleting",
  webSearch: "Searching the web", readWebPage: "Reading the page", importRecipe: "Importing the recipe", listImports: "Checking your imports", getImportDraft: "Reading the import", approveImportDraft: "Saving the import",
  navigate: "Opening the page", findActiveCooks: "Finding your cooks", tagRecipes: "Organizing recipes", setRecipeFavorites: "Updating your favorites", scaleRecipe: "Scaling the recipe",
  listRecipePhotos: "Looking at photos", setRecipeCoverPhoto: "Setting the cover photo", addPhotoToRecipe: "Adding the photo", addPhotoToCook: "Adding the photo to your cook", createShareLink: "Creating a share link", listShareLinks: "Checking share links", revokeShareLink: "Turning off the link", getAiUsage: "Adding up your usage",
};
const completedLabels: Record<string, string> = {
  listArtifacts: "Lists and plans found", getArtifact: "List or plan read", createGroceryList: "Grocery list saved", deriveGroceryList: "Grocery list saved", addGroceryItems: "Grocery items added", removeGroceryItem: "Grocery item removed", setGroceryItemChecked: "Checklist saved", createMealPlan: "Meal plan saved", addMealPlanEntry: "Meal added", removeMealPlanEntry: "Meal removed",
  startCookingSession: "Cook started", getCookingSession: "Cook read", updateCookingProgress: "Cooking progress saved", finishCookingSession: "Cook finished", abandonCookingSession: "Cook ended", addCookingSessionNote: "Cooking note saved", listCookingHistory: "Cooking history read", searchRecipes: "Searched your cookbook", getRecipe: "Read the recipe", createRecipe: "Recipe saved", updateRecipe: "Recipe updated", archiveRecipe: "Recipe archived", restoreArchivedRecipe: "Recipe returned to Library", restoreRecipeVersion: "Version restored", listRecipeVersions: "Read version history", listRecipeNotes: "Read recipe notes", addRecipeNote: "Observation saved", setRecipeFavorite: "Favorites updated",
  updateMealPlanEntry: "Meal updated", updateGroceryItem: "Item updated", clearCheckedGroceryItems: "Checked items cleared", renameArtifact: "Renamed", deleteArtifact: "Deleted",
  webSearch: "Searched the web", readWebPage: "Read a web page", importRecipe: "Import started", listImports: "Checked imports", getImportDraft: "Read the import", approveImportDraft: "Import saved to your Library",
  navigate: "Opened the page", findActiveCooks: "Checked your cooks", tagRecipes: "Recipes organized", setRecipeFavorites: "Favorites updated", scaleRecipe: "Scaled ingredients",
  listRecipePhotos: "Looked at photos", setRecipeCoverPhoto: "Cover photo set", addPhotoToRecipe: "Photo added to the recipe", addPhotoToCook: "Photo added to your cook", createShareLink: "Share link created", listShareLinks: "Checked share links", revokeShareLink: "Share link turned off", getAiUsage: "Usage totals",
};
// Lookups are the agent's working steps, not results. They fold into one
// expandable line, like other assistants' "used N tools", once finished.
const lookups = new Set(["listArtifacts", "getArtifact", "getCookingSession", "listCookingHistory", "searchRecipes", "getRecipe", "listRecipeVersions", "listRecipeNotes",
  "webSearch", "readWebPage", "listImports", "getImportDraft", "navigate", "findActiveCooks", "listRecipePhotos", "listShareLinks"]);

const approvalLabels: Record<string, [string, string]> = {
  createRecipe: ["Save recipe", "Don’t save"], abandonCookingSession: ["End this cook", "Keep cooking"], archiveRecipe: ["Confirm archive", "Keep recipe"],
  deleteArtifact: ["Delete", "Keep it"], revokeShareLink: ["Turn off link", "Keep link"],
};

type Part = SiftUIMessage["parts"][number];
type ToolPart = Extract<Part, { toolCallId: string }>;
const toolName = (part: ToolPart) => part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
function ToolIcon({ name, className = "size-3.5 shrink-0" }: { name: string; className?: string }) {
  const props = { className, "aria-hidden": true } as const;
  if (name === "searchRecipes") return <Search {...props} />;
  if (/Grocery|Item/.test(name)) return <ListChecks {...props} />;
  if (/Meal|Artifact/.test(name)) return <CalendarDays {...props} />;
  if (/Cooking/.test(name)) return <ChefHat {...props} />;
  if (/Favorite/.test(name)) return <Heart {...props} />;
  if (/web|Web|Import|import/.test(name)) return <Globe {...props} />;
  if (/Share/.test(name)) return <Link2 {...props} />;
  if (name === "navigate") return <ArrowUpRight {...props} />;
  if (/update|create|Note/.test(name)) return <PencilLine {...props} />;
  return <BookOpen {...props} />;
}
// Sift's tools return { ok }; provider-run tools (web search) return { results } or { error }.
const succeeded = (part: ToolPart) => part.state === "output-available" && !!part.output && typeof part.output === "object" && ("ok" in part.output ? part.output.ok === true : !("error" in part.output));

type Segment = { kind: "part"; part: Part; index: number } | { kind: "lookups"; parts: { part: ToolPart; index: number }[] };
function segments(parts: Part[]) {
  const result: Segment[] = [];
  parts.forEach((part, index) => {
    if (isToolUIPart(part) && lookups.has(toolName(part)) && succeeded(part)) {
      const last = result.at(-1);
      if (last?.kind === "lookups") last.parts.push({ part, index });
      else result.push({ kind: "lookups", parts: [{ part, index }] });
    } else if (part.type === "text" || isToolUIPart(part)) result.push({ kind: "part", part, index });
  });
  return result;
}

type Props = { message: SiftUIMessage; busy: boolean; streaming?: boolean; animate?: boolean; liveArtifactReceipts: ReadonlySet<string>; onApproval: (id: string, approved: boolean) => void; onNavigate: () => void };

export const AssistantMessage = memo(function AssistantMessage({ message, busy, streaming = false, animate = false, liveArtifactReceipts, onApproval, onNavigate }: Props) {
  const [copied, setCopied] = useState(false), [copyError, setCopyError] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  if (message.role !== "user" && message.role !== "assistant") return null;
  const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n\n");
  if (message.role === "user") {
    const images = message.parts.flatMap((part) => part.type === "file" && part.mediaType.startsWith("image/") ? [part.url] : []);
    return <article aria-label="Your message" className={`flex flex-col items-end gap-1.5 ${animate ? "sift-enter" : ""}`}><p className="sr-only">You</p>
      {images.length > 0 && <div className={`grid max-w-[85%] gap-1.5 ${images.length > 1 ? "grid-cols-2" : ""}`}>{images.map((url, index) => <a key={url} href={url} target="_blank" rel="noopener" className={`relative block overflow-hidden rounded-2xl bg-muted ${images.length > 1 ? "size-32" : "h-52 w-52"}`}><Image src={url} alt={`Your photo ${index + 1}`} fill unoptimized sizes="208px" className="object-cover" /></a>)}</div>}
      {!!text && <div className="max-w-[85%] rounded-[22px] rounded-br-md bg-muted px-4 py-2.5">
        {message.parts.map((part, index) => part.type === "text" ? <p key={index} className="whitespace-pre-wrap break-words text-sm leading-6">{part.text}</p> : null)}
      </div>}
    </article>;
  }

  const visible = message.parts.filter((part) => part.type === "text" ? !!part.text : isToolUIPart(part));
  const last = visible.at(-1);
  const lastTextIndex = message.parts.findLastIndex((part) => part.type === "text");
  // While a reply streams, exactly one place shows activity: the running
  // tool's own line, the text cursor, or a trailing "Thinking…" between steps.
  const trailing = streaming && (!last || (isToolUIPart(last) && (last.state === "output-available" || last.state === "output-error" || last.state === "output-denied")));
  return <article aria-label="Sift response" aria-busy={streaming} className={`sift-response ${animate ? "sift-enter" : ""}`}>
    <div className="min-w-0 space-y-3">
      <p className="mb-2.5 flex items-center gap-1.5"><SiftMark className={`size-5 ${streaming ? "sift-pulse" : ""}`} /><span className="sr-only">Sift</span></p>
      {segments(message.parts).map((segment) => segment.kind === "lookups"
        ? <LookupGroup key={segment.parts[0].part.toolCallId} parts={segment.parts} onNavigate={onNavigate} />
        : segment.part.type === "text"
          ? segment.part.text ? <AssistantMarkdown key={segment.index} text={segment.part.text} streaming={streaming && segment.index === lastTextIndex && last === segment.part} onNavigate={onNavigate} /> : null
          : <ToolPartView key={(segment.part as ToolPart).toolCallId} part={segment.part as ToolPart} index={segment.index} messageId={message.id} busy={busy} streaming={streaming} liveArtifactReceipts={liveArtifactReceipts} onApproval={onApproval} onNavigate={onNavigate} />)}
      {trailing && <AssistantActivity />}
      {text && !streaming && <div className="-ml-2 flex items-center pt-0.5"><Button variant="ghost" size="icon" aria-label={copied ? "Response copied" : "Copy response"} title={copied ? "Copied" : "Copy response"} className="size-8 rounded-lg text-muted-foreground/70 hover:text-foreground" onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setCopyError(false); if (copyTimer.current) clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(false), 2000); }
        catch { setCopyError(true); }
      }}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</Button>{copied && <span role="status" className="sr-only">Response copied</span>}{copyError && <p role="alert" className="text-xs text-muted-foreground">Couldn’t copy. Select the text to copy it.</p>}</div>}
    </div>
  </article>;
}, (before, after) => before.message === after.message && before.busy === after.busy && before.streaming === after.streaming && before.animate === after.animate
  && before.onApproval === after.onApproval && before.onNavigate === after.onNavigate
  && before.message.parts.every((_, index) => before.liveArtifactReceipts.has(`${before.message.id}:${index}`) === after.liveArtifactReceipts.has(`${after.message.id}:${index}`)));

function LookupGroup({ parts, onNavigate }: { parts: { part: ToolPart; index: number }[]; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const names = parts.map(({ part }) => toolName(part));
  const summary = names.length === 1 ? completedLabels[names[0]] ?? "Checked your cookbook" : `Checked your cookbook · ${names.length} steps`;
  return <div className="text-[13px]">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="-ml-1 flex min-h-8 items-center gap-2 rounded-lg px-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
      <ToolIcon name={names[0]} />{summary}<ChevronDown className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    {open && <div className="mt-2 space-y-3 border-l border-border pl-4">{parts.map(({ part }) => <div key={part.toolCallId} className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{completedLabels[toolName(part)] ?? "Done"}</p>
      <ToolOutput output={part.state === "output-available" ? part.output : null} onNavigate={onNavigate} />
    </div>)}</div>}
  </div>;
}

function ToolPartView({ part, index, messageId, busy, streaming, liveArtifactReceipts, onApproval, onNavigate }: { part: ToolPart; index: number; messageId: string; busy: boolean; streaming: boolean; liveArtifactReceipts: ReadonlySet<string>; onApproval: (id: string, approved: boolean) => void; onNavigate: () => void }) {
  const name = toolName(part);
  if (part.state === "approval-requested") return <div className="rounded-2xl border bg-background p-4 shadow-sm">
    <p className="text-sm font-medium">{part.approval.requestReason || "Confirm this recipe change?"}</p>
    {part.approval.isAutomatic ? <p className="mt-2 text-xs text-muted-foreground">Checking this action…</p> : <>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{name === "createRecipe" ? "Nothing is saved until you choose Save recipe." : name === "abandonCookingSession" ? "This cook’s notes and photos will be kept in your recipe’s history." : name === "deleteArtifact" ? "Recipes it refers to are not affected." : name === "revokeShareLink" ? "You can create a new link at any time." : "Your recipe and its version history will be kept."}</p>
      {part.type === "tool-createRecipe" && <details className="mt-3 text-sm"><summary className="cursor-pointer">Preview recipe</summary><div className="mt-3 space-y-4">
        <p>{part.input.content.servings} servings</p>
        {part.input.content.description && <p>{part.input.content.description}</p>}
        {part.input.content.ingredientSections.map((section, sectionIndex) => <section key={`ingredients-${sectionIndex}`}><p className="font-medium">{section.name || "Ingredients"}</p><ul className="mt-1 list-disc space-y-1 pl-5">{section.items.map((item, itemIndex) => <li key={itemIndex}>{item.text}</li>)}</ul></section>)}
        {part.input.content.instructionSections.map((section, sectionIndex) => <section key={`steps-${sectionIndex}`}><p className="font-medium">{section.name || "Method"}</p><ol className="mt-1 list-decimal space-y-2 pl-5">{section.steps.map((step, stepIndex) => <li key={stepIndex}>{step}</li>)}</ol></section>)}
      </div></details>}
      <div className="mt-4 flex flex-wrap gap-2"><Button size="sm" className="rounded-full" disabled={busy} onClick={() => onApproval(part.approval.id, true)}>{approvalLabels[name]?.[0] ?? "Confirm archive"}</Button><Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => onApproval(part.approval.id, false)}>{approvalLabels[name]?.[1] ?? "Keep recipe"}</Button></div>
    </>}
  </div>;
  if (part.state === "output-denied") return <div className="rounded-xl border p-3 text-xs text-muted-foreground">Action not taken.{part.approval.reason && <p className="mt-1 leading-relaxed">{part.approval.reason}</p>}</div>;
  if (part.state === "output-error") return <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{part.errorText || "This action couldn’t be completed."}</p>;
  if (part.state !== "output-available") {
    if (part.state === "approval-responded") return <AssistantActivity label="Decision received" icon={<ToolIcon name={name} className="size-3.5 text-muted-foreground" />} />;
    return streaming || busy
      ? <AssistantActivity label={`${toolLabels[name] || "Working on your request"}…`} icon={<ToolIcon name={name} className="size-3.5 text-muted-foreground" />} />
      : <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><ToolIcon name={name} />Action unfinished</p>;
  }
  const output = part.output;
  if (!output || typeof output !== "object" || !("ok" in output)) return null;
  if (output.ok === false) return <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{"error" in output && typeof output.error === "string" ? output.error : "This action couldn’t be completed."}</div>;
  const artifact = artifactPreviewSchema.safeParse(output);
  if (artifact.success && liveArtifactReceipts.has(`${messageId}:${index}`)) return <ArtifactCard initial={artifact.data} onNavigate={onNavigate} />;
  return <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/25 p-3.5"><p className="flex items-center gap-2 text-xs font-medium"><span className="flex size-5 items-center justify-center rounded-full bg-foreground text-background"><Check className="size-3" /></span>{completedLabels[name] || "Done"}{"versionNumber" in output && typeof output.versionNumber === "number" && <span className="font-normal text-muted-foreground">· Version {output.versionNumber}</span>}</p>
    <ToolOutput output={output} onNavigate={onNavigate} />
  </div>;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ShareUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="flex items-center gap-2 rounded-xl border bg-background p-1.5 pl-3">
    <span className="min-w-0 flex-1 truncate font-mono text-xs">{url}</span>
    <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* The URL stays selectable. */ } }}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy link"}</Button>
  </div>;
}

function ToolOutput({ output, onNavigate }: { output: unknown; onNavigate: () => void }) {
  if (!output || typeof output !== "object") return null;
  const artifact = artifactPreviewSchema.safeParse(output);
  return <>
    {"changeSummary" in output && typeof output.changeSummary === "string" && <p className="text-xs leading-relaxed text-muted-foreground">{output.changeSummary}</p>}
    {"shareUrl" in output && typeof output.shareUrl === "string" && <ShareUrl url={output.shareUrl} />}
    {"removed" in output && typeof output.removed === "number" && <p className="text-xs text-muted-foreground">{count(output.removed, "item", "items")} removed</p>}
    {"updated" in output && Array.isArray(output.updated) && <p className="text-xs text-muted-foreground">{count(output.updated.length, "recipe", "recipes")} updated{"unchanged" in output && typeof output.unchanged === "number" && output.unchanged ? ` · ${output.unchanged} already set` : ""}</p>}
    {"count" in output && typeof output.count === "number" && "favorite" in output && <p className="text-xs text-muted-foreground">{count(output.count, "recipe", "recipes")} {output.favorite ? "favorited" : "unfavorited"}</p>}
    {"results" in output && Array.isArray(output.results) && <ul className="divide-y">{output.results.slice(0, 8).map((result: { url?: unknown; title?: unknown }, index: number) => typeof result.url === "string" && /^https?:/.test(result.url) ? <li key={index}><a href={result.url} target="_blank" rel="noopener noreferrer" className="flex min-h-10 items-center justify-between gap-3 py-2 text-sm"><span className="min-w-0"><span className="block truncate">{typeof result.title === "string" ? result.title : result.url}</span><span className="block truncate text-xs text-muted-foreground">{new URL(result.url).hostname}</span></span><ArrowUpRight className="size-4 shrink-0 text-muted-foreground" /></a></li> : null)}</ul>}
    {"url" in output && typeof output.url === "string" && /^https?:/.test(output.url) && !("results" in output) && <a href={output.url} target="_blank" rel="noopener noreferrer" className="flex min-h-9 items-center justify-between gap-3 text-sm underline-offset-4 hover:underline"><span className="min-w-0 truncate">{"recipe" in output && output.recipe && typeof output.recipe === "object" && "title" in output.recipe && typeof output.recipe.title === "string" ? output.recipe.title : new URL(output.url).hostname}</span><ArrowUpRight className="size-4 shrink-0 text-muted-foreground" /></a>}
    {"ingredientSections" in output && Array.isArray(output.ingredientSections) && "factor" in output && <div className="space-y-2 text-sm">{"servings" in output && typeof output.servings === "number" && <p className="text-xs text-muted-foreground">For {output.servings} servings</p>}{output.ingredientSections.map((section: { name?: string; items: string[] }, index: number) => <div key={index}>{section.name && <p className="font-medium">{section.name}</p>}<ul className="list-disc space-y-0.5 pl-5">{section.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul></div>)}</div>}
    {"importId" in output && "href" in output && typeof output.href === "string" && output.href.startsWith("/imports/") && <Link href={output.href} onClick={onNavigate} className="flex min-h-9 items-center justify-between gap-3 text-sm underline-offset-4 hover:underline">Review the import<ChevronRight className="size-4 shrink-0 text-muted-foreground" /></Link>}
    {"cooks" in output && Array.isArray(output.cooks) && <ul className="divide-y">{output.cooks.slice(0, 10).map((cook: { sessionId: string; recipeId: string; title: string }) => <li key={cook.sessionId}><Link href={`/recipes/${cook.recipeId}?cook=${cook.sessionId}`} onClick={onNavigate} className="flex min-h-10 items-center justify-between gap-3 py-2 text-sm">{cook.title}<ChevronRight className="size-4 shrink-0 text-muted-foreground" /></Link></li>)}</ul>}
    {"body" in output && typeof output.body === "string" && <p className="whitespace-pre-wrap text-sm leading-relaxed">{output.body}</p>}
    {artifact.success && <Link href={`/artifacts/${artifact.data.artifactId}`} onClick={onNavigate} className="flex min-h-10 items-center justify-between gap-3 text-sm underline-offset-4 hover:underline"><span className="min-w-0 break-words">{artifact.data.title}</span><ChevronRight className="size-4 shrink-0 text-muted-foreground" /></Link>}
    {"recipeId" in output && typeof output.recipeId === "string" && <Link href={`/recipes/${output.recipeId}${"sessionId" in output && typeof output.sessionId === "string" ? `?cook=${output.sessionId}` : ""}`} onClick={onNavigate} className="flex min-h-9 items-center justify-between gap-3 text-sm underline-offset-4 hover:underline">{"title" in output && typeof output.title === "string" ? output.title : "Open recipe"}<ChevronRight className="size-4 shrink-0 text-muted-foreground" /></Link>}
    {"artifacts" in output && Array.isArray(output.artifacts) && <><p className="text-xs text-muted-foreground">{count("total" in output && typeof output.total === "number" ? output.total : output.artifacts.length, "list or plan", "lists and plans")} found</p><ul className="divide-y">{output.artifacts.slice(0, 30).map((item: { artifactId: string; title: string }) => <li key={item.artifactId}><Link href={`/artifacts/${item.artifactId}`} onClick={onNavigate} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm"><span className="min-w-0 break-words">{item.title}</span><ChevronRight className="size-4 shrink-0 text-muted-foreground" /></Link></li>)}</ul></>}
    {"recipes" in output && Array.isArray(output.recipes) && <><p className="text-xs text-muted-foreground">{count("total" in output && typeof output.total === "number" ? output.total : output.recipes.length, "recipe", "recipes")} found</p><ul className="divide-y">{output.recipes.slice(0, 8).map((recipe: { recipeId: string; title: string }) => <li key={recipe.recipeId}><Link href={`/recipes/${recipe.recipeId}`} onClick={onNavigate} className="flex min-h-10 items-center justify-between gap-3 py-2 text-sm">{recipe.title}<ChevronRight className="size-4 shrink-0 text-muted-foreground" /></Link></li>)}</ul></>}
  </>;
}
