"use client";
import Link from "next/link";
import { Check, ChevronRight, LoaderCircle } from "lucide-react";
import { isToolUIPart } from "ai";
import type { SiftUIMessage } from "@/ai/assistant-runtime";
import { Button } from "./ui/button";
import { ArtifactCard, artifactPreviewSchema } from "./artifact-card";

const toolLabels: Record<string, string> = {
  listArtifacts: "Finding your lists and plans", getArtifact: "Reading your list or plan", createGroceryList: "Making your grocery list", deriveGroceryList: "Gathering recipe ingredients", addGroceryItems: "Adding grocery items", removeGroceryItem: "Removing an item", setGroceryItemChecked: "Updating your checklist", createMealPlan: "Making your meal plan", addMealPlanEntry: "Adding a meal", removeMealPlanEntry: "Removing a meal",
  startCookingSession: "Starting your cook", getCookingSession: "Reading this cook", updateCookingProgress: "Saving cooking progress", finishCookingSession: "Finishing your cook", abandonCookingSession: "Ending your cook", addCookingSessionNote: "Saving your cooking note", listCookingHistory: "Reading cooking history", searchRecipes: "Looking through your cookbook", getRecipe: "Reading the recipe", createRecipe: "Saving a recipe", updateRecipe: "Updating the recipe", archiveRecipe: "Archiving the recipe", restoreArchivedRecipe: "Returning the recipe to your Library", restoreRecipeVersion: "Restoring a version", listRecipeVersions: "Reading version history", listRecipeNotes: "Reading recipe notes", addRecipeNote: "Saving your observation", setRecipeFavorite: "Updating your favorites",
};
const completedLabels: Record<string, string> = {
  listArtifacts: "Lists and plans found", getArtifact: "List or plan read", createGroceryList: "Grocery list saved", deriveGroceryList: "Grocery list saved", addGroceryItems: "Grocery items added", removeGroceryItem: "Grocery item removed", setGroceryItemChecked: "Checklist saved", createMealPlan: "Meal plan saved", addMealPlanEntry: "Meal added", removeMealPlanEntry: "Meal removed",
  startCookingSession: "Cook started", getCookingSession: "Cook read", updateCookingProgress: "Cooking progress saved", finishCookingSession: "Cook finished", abandonCookingSession: "Cook ended", addCookingSessionNote: "Cooking note saved", listCookingHistory: "Cooking history read", searchRecipes: "Cookbook search", getRecipe: "Recipe read", createRecipe: "Recipe saved", updateRecipe: "Recipe updated", archiveRecipe: "Recipe archived", restoreArchivedRecipe: "Recipe returned to Library", restoreRecipeVersion: "Version restored", listRecipeVersions: "Version history read", listRecipeNotes: "Recipe notes read", addRecipeNote: "Observation saved", setRecipeFavorite: "Favorites updated",
};

export function AssistantMessage({ message, busy, liveArtifactReceipts, onApproval, onNavigate }: { message: SiftUIMessage; busy: boolean; liveArtifactReceipts: ReadonlySet<string>; onApproval: (id: string, approved: boolean) => void; onNavigate: () => void }) {
  if (message.role !== "user" && message.role !== "assistant") return null;
  return <article aria-label={message.role === "user" ? "Your message" : "Sift response"} className={message.role === "user" ? "ml-6 rounded-2xl rounded-br-sm bg-muted p-4" : "space-y-3"}>
    <p className="mb-2 text-xs font-medium text-muted-foreground">{message.role === "user" ? "You" : "sift"}</p>
    {message.parts.map((part, index) => {
      if (part.type === "text") return <p key={index} className="whitespace-pre-wrap break-words text-sm leading-7">{part.text}</p>;
      if (!isToolUIPart(part)) return null;
      const name = part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
      if (part.state === "approval-requested") return <div key={part.toolCallId} className="rounded-xl border p-4"><p className="text-sm font-medium">{part.approval.requestReason || "Confirm this recipe change?"}</p>{part.approval.isAutomatic ? <p className="mt-2 text-xs text-muted-foreground">Checking this action…</p> : <><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{name === "abandonCookingSession" ? "This cook’s notes and photos will be kept in your recipe’s history." : "Your recipe and its version history will be kept."}</p><div className="mt-4 flex flex-wrap gap-2"><Button size="sm" disabled={busy} onClick={() => onApproval(part.approval.id, true)}>{name === "abandonCookingSession" ? "End this cook" : "Confirm archive"}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => onApproval(part.approval.id, false)}>{name === "abandonCookingSession" ? "Keep cooking" : "Keep recipe"}</Button></div></>}</div>;
      if (part.state === "output-denied") return <div key={part.toolCallId} className="rounded-xl border p-3 text-xs text-muted-foreground">Action not taken.{part.approval.reason && <p className="mt-1 leading-relaxed">{part.approval.reason}</p>}</div>;
      if (part.state === "output-error") return <p key={part.toolCallId} role="alert" className="rounded-xl border p-3 text-sm text-destructive">{part.errorText || "This action couldn’t be completed."}</p>;
      if (part.state !== "output-available") return <div key={part.toolCallId} className="flex items-center gap-2 text-xs text-muted-foreground">{busy && <LoaderCircle className="size-3.5 animate-spin" />}{part.state === "approval-responded" ? "Decision received" : busy ? toolLabels[name] || "Working on your request" : "Action unfinished"}</div>;
      const output = part.output;
      if (!output || typeof output !== "object" || !("ok" in output)) return null;
      if (output.ok === false) return <div key={part.toolCallId} role="alert" className="rounded-xl border p-3 text-sm text-destructive">{"error" in output && typeof output.error === "string" ? output.error : "This action couldn’t be completed."}</div>;
      const artifact = artifactPreviewSchema.safeParse(output);
      if (artifact.success && liveArtifactReceipts.has(`${message.id}:${index}`)) return <ArtifactCard key={part.toolCallId} initial={artifact.data} onNavigate={onNavigate} />;
      return <div key={part.toolCallId} className="space-y-2 rounded-xl border bg-muted/20 p-3"><p className="flex items-center gap-2 text-xs font-medium"><Check className="size-3.5 text-muted-foreground" />{completedLabels[name] || "Done"}{"versionNumber" in output && typeof output.versionNumber === "number" && <span className="font-normal text-muted-foreground">· Version {output.versionNumber}</span>}</p>
        {"changeSummary" in output && typeof output.changeSummary === "string" && <p className="text-xs leading-relaxed text-muted-foreground">{output.changeSummary}</p>}
        {"body" in output && typeof output.body === "string" && <p className="whitespace-pre-wrap text-sm leading-relaxed">{output.body}</p>}
        {artifact.success && <Link href={`/artifacts/${artifact.data.artifactId}`} onClick={onNavigate} className="flex min-h-10 items-center justify-between gap-3 text-sm underline-offset-4 hover:underline"><span className="min-w-0 break-words">{artifact.data.title}</span><ChevronRight className="size-4 shrink-0 text-muted-foreground" /></Link>}
        {"recipeId" in output && typeof output.recipeId === "string" && <Link href={`/recipes/${output.recipeId}${"sessionId" in output && typeof output.sessionId === "string" ? `?cook=${output.sessionId}` : ""}`} onClick={onNavigate} className="flex min-h-9 items-center justify-between gap-3 text-sm underline-offset-4 hover:underline">{"title" in output && typeof output.title === "string" ? output.title : "Open recipe"}<ChevronRight className="size-4 shrink-0 text-muted-foreground" /></Link>}
        {"artifacts" in output && Array.isArray(output.artifacts) && <><p className="text-xs text-muted-foreground">{"total" in output && typeof output.total === "number" ? output.total : output.artifacts.length} lists and plans found</p><ul className="divide-y">{output.artifacts.slice(0, 30).map((artifact) => <li key={artifact.artifactId}><Link href={`/artifacts/${artifact.artifactId}`} onClick={onNavigate} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm"><span className="min-w-0 break-words">{artifact.title}</span><ChevronRight className="size-4 shrink-0 text-muted-foreground" /></Link></li>)}</ul></>}
        {"recipes" in output && Array.isArray(output.recipes) && <><p className="text-xs text-muted-foreground">{"total" in output && typeof output.total === "number" ? output.total : output.recipes.length} recipes found</p><ul className="divide-y">{output.recipes.slice(0, 8).map((recipe) => <li key={recipe.recipeId}><Link href={`/recipes/${recipe.recipeId}`} onClick={onNavigate} className="flex min-h-10 items-center justify-between gap-3 py-2 text-sm">{recipe.title}<ChevronRight className="size-4 shrink-0 text-muted-foreground" /></Link></li>)}</ul></>}
      </div>;
    })}
  </article>;
}
