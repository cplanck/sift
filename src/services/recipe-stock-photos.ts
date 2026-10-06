import "server-only";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/connection";
import { recipes, recipeStockPhotos } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { getRecipe } from "./recipes";
import { consumeLimit } from "./rate-limit";
import { findStockPhoto, stockPhotosConfigured } from "./stock-photos";
import { assertMembership, type Actor } from "./workspaces";

export async function getRecipeStockPhoto(db: Database, actor: Actor, id: string) {
  const recipe = await getRecipe(db, actor, id);
  if (recipe.coverPhotoId || recipe.coverSelection === "none") return null;
  if (recipe.stockPhoto) return recipe.stockPhoto;
  if (stockPhotosConfigured()) await consumeLimit(db, actor, "photo", 200, 3600, "stock-photo");
  const photo = await findStockPhoto(recipe.version.content.title, recipe.version.content.tags);

  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    // Serialize first selections and check for a cover uploaded during the search.
    const [current] = await tx.select().from(recipes).where(and(eq(recipes.id, id), eq(recipes.workspaceId, actor.workspaceId))).for("update");
    if (!current) throw new DomainError("NOT_FOUND", "Recipe not found.");
    if (current.coverPhotoId || current.coverSelection === "none") return null;
    const scope = and(eq(recipeStockPhotos.recipeId, id), eq(recipeStockPhotos.workspaceId, actor.workspaceId));
    const [saved] = await tx.select().from(recipeStockPhotos).where(scope);
    if (saved) return saved.photo;
    // A temporary failure or missing API key must not pin a generic placeholder.
    if (!photo.src.startsWith("/stock/")) {
      await tx.insert(recipeStockPhotos).values({ recipeId: id, workspaceId: actor.workspaceId, photo });
    }
    return photo;
  });
}
