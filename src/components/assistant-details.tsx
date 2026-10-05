import Link from "next/link";
import type { Conversation } from "./assistant-shell";
import { AiUsageDetails } from "./ai-usage-details";

const actionLabels: Record<string, string> = { startCookingSession: "Cook started", updateCookingProgress: "Cooking progress saved", finishCookingSession: "Cook finished", abandonCookingSession: "Cook ended", addCookingSessionNote: "Cooking note saved", createRecipe: "Recipe saved", updateRecipe: "Recipe updated", archiveRecipe: "Recipe archived", restoreArchivedRecipe: "Recipe returned to Library", restoreRecipeVersion: "Version restored", addRecipeNote: "Observation saved", setRecipeFavorite: "Favorites updated" };

export function AssistantDetails({ conversation, showReceipts, onNavigate }: { conversation: Conversation; showReceipts: boolean; onNavigate: () => void }) {
  return <div className="space-y-3">
    {showReceipts && conversation.receipts.length > 0 && <details className="rounded-xl border p-3"><summary className="cursor-pointer py-1 text-xs font-medium">Saved actions ({conversation.receipts.length})</summary><p className="my-3 text-xs leading-relaxed text-muted-foreground">These changes were saved, even if a reply was interrupted.</p><ul className="divide-y">{conversation.receipts.map((receipt, index) => {
      const result = receipt.result && typeof receipt.result === "object" && !Array.isArray(receipt.result) ? receipt.result as Record<string, unknown> : {};
      return <li key={index} className="py-3 text-xs"><p className="font-medium">{actionLabels[receipt.toolName] || "Recipe change saved"}</p>{typeof result.changeSummary === "string" && <p className="mt-2 leading-relaxed text-muted-foreground">{result.changeSummary}</p>}{typeof result.recipeId === "string" && <Link href={`/recipes/${result.recipeId}${typeof result.sessionId === "string" ? `?cook=${result.sessionId}` : ""}`} onClick={onNavigate} className="mt-2 inline-flex min-h-9 items-center underline underline-offset-4">{typeof result.title === "string" ? result.title : "Open recipe"}</Link>}</li>;
    })}</ul></details>}
    <AiUsageDetails usage={conversation.usage} />
  </div>;
}
