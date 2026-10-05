"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BookOpen, CalendarDays, Check, ChefHat, ChevronRight, Copy, Heart, ListChecks, LoaderCircle, PencilLine, Search } from "lucide-react";
import { isToolUIPart } from "ai";
import type { SiftUIMessage } from "@/ai/assistant-runtime";
import { Button } from "./ui/button";
import { ArtifactCard, artifactPreviewSchema } from "./artifact-card";
import { AssistantMarkdown } from "./assistant-markdown";
import { SiftMark } from "./brand";

const toolLabels: Record<string, string> = {
  listArtifacts: "Finding your lists and plans", getArtifact: "Reading your list or plan", createGroceryList: "Making your grocery list", deriveGroceryList: "Gathering recipe ingredients", addGroceryItems: "Adding grocery items", removeGroceryItem: "Removing an item", setGroceryItemChecked: "Updating your checklist", createMealPlan: "Making your meal plan", addMealPlanEntry: "Adding a meal", removeMealPlanEntry: "Removing a meal",
  startCookingSession: "Starting your cook", getCookingSession: "Reading this cook", updateCookingProgress: "Saving cooking progress", finishCookingSession: "Finishing your cook", abandonCookingSession: "Ending your cook", addCookingSessionNote: "Saving your cooking note", listCookingHistory: "Reading cooking history", searchRecipes: "Looking through your cookbook", getRecipe: "Reading the recipe", createRecipe: "Saving a recipe", updateRecipe: "Updating the recipe", archiveRecipe: "Archiving the recipe", restoreArchivedRecipe: "Returning the recipe to your Library", restoreRecipeVersion: "Restoring a version", listRecipeVersions: "Reading version history", listRecipeNotes: "Reading recipe notes", addRecipeNote: "Saving your observation", setRecipeFavorite: "Updating your favorites",
};
const completedLabels: Record<string, string> = {
  listArtifacts: "Lists and plans found", getArtifact: "List or plan read", createGroceryList: "Grocery list saved", deriveGroceryList: "Grocery list saved", addGroceryItems: "Grocery items added", removeGroceryItem: "Grocery item removed", setGroceryItemChecked: "Checklist saved", createMealPlan: "Meal plan saved", addMealPlanEntry: "Meal added", removeMealPlanEntry: "Meal removed",
  startCookingSession: "Cook started", getCookingSession: "Cook read", updateCookingProgress: "Cooking progress saved", finishCookingSession: "Cook finished", abandonCookingSession: "Cook ended", addCookingSessionNote: "Cooking note saved", listCookingHistory: "Cooking history read", searchRecipes: "Cookbook search", getRecipe: "Recipe read", createRecipe: "Recipe saved", updateRecipe: "Recipe updated", archiveRecipe: "Recipe archived", restoreArchivedRecipe: "Recipe returned to Library", restoreRecipeVersion: "Version restored", listRecipeVersions: "Version history read", listRecipeNotes: "Recipe notes read", addRecipeNote: "Observation saved", setRecipeFavorite: "Favorites updated",
};

export function AssistantMessage({ message, busy, streaming = false, liveArtifactReceipts, onApproval, onNavigate }: { message: SiftUIMessage; busy: boolean; streaming?: boolean; liveArtifactReceipts: ReadonlySet<string>; onApproval: (id: string, approved: boolean) => void; onNavigate: () => void }) {
  const [copied, setCopied] = useState(false), [copyError, setCopyError] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n\n");
  const lastTextIndex = message.parts.findLastIndex((part) => part.type === "text");
  if (message.role !== "user" && message.role !== "assistant") return null;
  return <article aria-label={message.role === "user" ? "Your message" : "Sift response"} className={message.role === "user" ? "flex justify-end" : "sift-response"}>
    <div className={message.role === "user" ? "max-w-[90%] rounded-[22px] rounded-br-md bg-muted px-4 py-3" : "min-w-0 space-y-3"}>
    <p className={message.role === "user" ? "sr-only" : "mb-3 flex items-center gap-1.5 text-xs font-semibold tracking-[-.03em]"}>{message.role === "user" ? "You" : <><SiftMark className="size-5" /><span className="sr-only">Sift</span></>}</p>
    {message.parts.map((part, index) => {
      if (part.type === "text") return message.role === "user" ? <p key={index} className="whitespace-pre-wrap break-words text-sm leading-6">{part.text}</p> : <AssistantMarkdown key={index} text={part.text} streaming={streaming && index === lastTextIndex} onNavigate={onNavigate} />;
      if (!isToolUIPart(part)) return null;
      const name = part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
      const Icon = name === "searchRecipes" ? Search : /Grocery|Item/.test(name) ? ListChecks : /Meal|Artifact/.test(name) ? CalendarDays : /Cooking/.test(name) ? ChefHat : /Favorite/.test(name) ? Heart : /update|create|Note/.test(name) ? PencilLine : BookOpen;
      if (part.state === "approval-requested") return <div key={part.toolCallId} className="rounded-xl border p-4"><p className="text-sm font-medium">{part.approval.requestReason || "Confirm this recipe change?"}</p>{part.approval.isAutomatic ? <p className="mt-2 text-xs text-muted-foreground">Checking this action…</p> : <><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{name === "abandonCookingSession" ? "This cook’s notes and photos will be kept in your recipe’s history." : "Your recipe and its version history will be kept."}</p><div className="mt-4 flex flex-wrap gap-2"><Button size="sm" disabled={busy} onClick={() => onApproval(part.approval.id, true)}>{name === "abandonCookingSession" ? "End this cook" : "Confirm archive"}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => onApproval(part.approval.id, false)}>{name === "abandonCookingSession" ? "Keep cooking" : "Keep recipe"}</Button></div></>}</div>;
      if (part.state === "output-denied") return <div key={part.toolCallId} className="rounded-xl border p-3 text-xs text-muted-foreground">Action not taken.{part.approval.reason && <p className="mt-1 leading-relaxed">{part.approval.reason}</p>}</div>;
      if (part.state === "output-error") return <p key={part.toolCallId} role="alert" className="rounded-xl border p-3 text-sm text-destructive">{part.errorText || "This action couldn’t be completed."}</p>;
      if (part.state !== "output-available") return <div key={part.toolCallId} className="flex items-center gap-2.5 rounded-xl bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground"><Icon className="size-3.5 shrink-0" />{part.state === "approval-responded" ? "Decision received" : busy ? toolLabels[name] || "Working on your request" : "Action unfinished"}{busy && <LoaderCircle className="ml-auto size-3.5 shrink-0 animate-spin" />}</div>;
      const output = part.output;
      if (!output || typeof output !== "object" || !("ok" in output)) return null;
      if (output.ok === false) return <div key={part.toolCallId} role="alert" className="rounded-xl border p-3 text-sm text-destructive">{"error" in output && typeof output.error === "string" ? output.error : "This action couldn’t be completed."}</div>;
      const artifact = artifactPreviewSchema.safeParse(output);
      if (artifact.success && liveArtifactReceipts.has(`${message.id}:${index}`)) return <ArtifactCard key={part.toolCallId} initial={artifact.data} onNavigate={onNavigate} />;
      return <div key={part.toolCallId} className="space-y-2 rounded-xl border border-border/70 bg-muted/25 p-3"><p className="flex items-center gap-2 text-xs font-medium"><Icon className="size-3.5 text-muted-foreground" />{completedLabels[name] || "Done"}{"versionNumber" in output && typeof output.versionNumber === "number" && <span className="font-normal text-muted-foreground">· Version {output.versionNumber}</span>}<Check className="ml-auto size-3 shrink-0 text-muted-foreground" /></p>
        {"changeSummary" in output && typeof output.changeSummary === "string" && <p className="text-xs leading-relaxed text-muted-foreground">{output.changeSummary}</p>}
        {"body" in output && typeof output.body === "string" && <p className="whitespace-pre-wrap text-sm leading-relaxed">{output.body}</p>}
        {artifact.success && <Link href={`/artifacts/${artifact.data.artifactId}`} onClick={onNavigate} className="flex min-h-10 items-center justify-between gap-3 text-sm underline-offset-4 hover:underline"><span className="min-w-0 break-words">{artifact.data.title}</span><ChevronRight className="size-4 shrink-0 text-muted-foreground" /></Link>}
        {"recipeId" in output && typeof output.recipeId === "string" && <Link href={`/recipes/${output.recipeId}${"sessionId" in output && typeof output.sessionId === "string" ? `?cook=${output.sessionId}` : ""}`} onClick={onNavigate} className="flex min-h-9 items-center justify-between gap-3 text-sm underline-offset-4 hover:underline">{"title" in output && typeof output.title === "string" ? output.title : "Open recipe"}<ChevronRight className="size-4 shrink-0 text-muted-foreground" /></Link>}
        {"artifacts" in output && Array.isArray(output.artifacts) && <><p className="text-xs text-muted-foreground">{"total" in output && typeof output.total === "number" ? output.total : output.artifacts.length} lists and plans found</p><ul className="divide-y">{output.artifacts.slice(0, 30).map((artifact) => <li key={artifact.artifactId}><Link href={`/artifacts/${artifact.artifactId}`} onClick={onNavigate} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm"><span className="min-w-0 break-words">{artifact.title}</span><ChevronRight className="size-4 shrink-0 text-muted-foreground" /></Link></li>)}</ul></>}
        {"recipes" in output && Array.isArray(output.recipes) && <><p className="text-xs text-muted-foreground">{"total" in output && typeof output.total === "number" ? output.total : output.recipes.length} recipes found</p><ul className="divide-y">{output.recipes.slice(0, 8).map((recipe) => <li key={recipe.recipeId}><Link href={`/recipes/${recipe.recipeId}`} onClick={onNavigate} className="flex min-h-10 items-center justify-between gap-3 py-2 text-sm">{recipe.title}<ChevronRight className="size-4 shrink-0 text-muted-foreground" /></Link></li>)}</ul></>}
      </div>;
    })}
    {message.role === "assistant" && text && !streaming && <div className="pt-0.5"><Button variant="ghost" size="icon" aria-label={copied ? "Response copied" : "Copy response"} title={copied ? "Copied" : "Copy response"} className="size-8 rounded-lg text-muted-foreground/70 hover:text-foreground" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(true); setCopyError(false); if (copyTimer.current) clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(false), 2000); }
      catch { setCopyError(true); }
    }}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</Button>{copied && <span role="status" className="sr-only">Response copied</span>}{copyError && <p role="alert" className="mt-1 text-xs text-muted-foreground">Couldn’t copy. Select the text to copy it.</p>}</div>}
    </div>
  </article>;
}
