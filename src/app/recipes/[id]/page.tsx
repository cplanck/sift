import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { database } from "@/db";
import { DomainError } from "@/domain/errors";
import { getRecipe, listRecipeNotes, listVersions } from "@/services/recipes";
import { AppHeader } from "@/components/app-header";
import { RecipeDetail } from "@/components/recipe-detail";

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer(), { id } = await params;
  const [recipe, notes, versions] = await Promise.all([getRecipe(database(), viewer, id), listRecipeNotes(database(), viewer, id), listVersions(database(), viewer, id)])
    .catch((error) => { if (error instanceof DomainError && error.code === "NOT_FOUND") notFound(); throw error; });
  return <><AppHeader name={viewer.name} /><RecipeDetail key={recipe.version.id} recipe={recipe} notes={notes} versions={versions} /></>;
}
