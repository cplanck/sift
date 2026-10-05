import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { database } from "@/db";
import { DomainError } from "@/domain/errors";
import { getRecipe, listRecipeNotes, listVersions } from "@/services/recipes";
import { listRecipePhotos } from "@/services/photos";
import { getActiveCookingSession, getCookingSession, listCookingHistory } from "@/services/cooking";
import { AppHeader } from "@/components/app-header";
import { RecipeDetail } from "@/components/recipe-detail";
import { CookingMode } from "@/components/cooking-mode";

function handleNotFound(error: unknown): never {
  if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
  throw error;
}
export default async function RecipePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cook?: string | string[] }> }) {
  const viewer = await requireViewer(), { id } = await params, { cook } = await searchParams;
  const recipe = await getRecipe(database(), viewer, id).catch(handleNotFound);
  if (cook !== undefined) {
    if (typeof cook !== "string") notFound();
    const session = await getCookingSession(database(), viewer, cook).catch(handleNotFound);
    if (session.recipeId !== id) notFound();
    return <><AppHeader name={viewer.name} /><CookingMode key={session.id} initialSession={session} canEdit={session.startedByUserId === viewer.userId} coverPhotoId={recipe.coverPhotoId} /></>;
  }
  const [notes, versions, photos, history, active] = await Promise.all([
    listRecipeNotes(database(), viewer, id), listVersions(database(), viewer, id), listRecipePhotos(database(), viewer, id),
    listCookingHistory(database(), viewer, id), getActiveCookingSession(database(), viewer, id),
  ]).catch(handleNotFound);
  return <><AppHeader name={viewer.name} /><RecipeDetail key={recipe.version.id} recipe={recipe} notes={notes} versions={versions} photos={photos} cookingHistory={history} activeSessionId={active?.id} /></>;
}
