import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { COOKING_LAYOUT_COOKIE, parseCookingLayoutCookie } from "@/lib/cooking-layout";
import { requireViewer } from "@/lib/auth";
import { database } from "@/db";
import { DomainError } from "@/domain/errors";
import { getRecipe, listRecipeNotes, listVersions } from "@/services/recipes";
import { listRecipePhotos } from "@/services/photos";
import { getActiveCookingSession, getCookingSession, listCookingHistory } from "@/services/cooking";
import { AppHeader } from "@/components/app-header";
import { RecipeDetail } from "@/components/recipe-detail";
import { CookingMode } from "@/components/cooking-mode";
import detailStyles from "@/components/recipe-detail.module.css";
import cookingStyles from "@/components/cooking-mode.module.css";

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
    const initialLayout = parseCookingLayoutCookie((await cookies()).get(COOKING_LAYOUT_COOKIE)?.value);
    // Request-time Server Component snapshot keeps the elapsed clock hydration stable.
    // eslint-disable-next-line react-hooks/purity
    const initialNow = Date.now();
    return <div className={session.status === "active" ? cookingStyles.screen : undefined}><AppHeader compact={session.status === "active"} name={viewer.name} mode="cook" cookHref={`/recipes/${id}?cook=${session.id}`} /><CookingMode key={session.id} initialSession={session} initialLayout={initialLayout} initialNow={initialNow} canEdit={session.startedByUserId === viewer.userId} coverPhotoId={recipe.coverPhotoId} coverSelection={recipe.coverSelection} coverImage={recipe.coverImage} stockPhoto={recipe.stockPhoto} /></div>;
  }
  const [notes, versions, photos, history, active] = await Promise.all([
    listRecipeNotes(database(), viewer, id), listVersions(database(), viewer, id), listRecipePhotos(database(), viewer, id),
    listCookingHistory(database(), viewer, id), getActiveCookingSession(database(), viewer, id),
  ]).catch(handleNotFound);
  return <div className={detailStyles.screen}><AppHeader name={viewer.name} mode="cook" /><RecipeDetail key={recipe.version.id} recipe={recipe} notes={notes} versions={versions} photos={photos} cookingHistory={history} activeSessionId={active?.id} /></div>;
}
