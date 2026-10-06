import { notFound } from "next/navigation";
import { database } from "@/db";
import { DomainError } from "@/domain/errors";
import { requireViewer } from "@/lib/auth";
import { getArtifact } from "@/services/artifacts";
import { shoppingRecipes } from "@/domain/grocery";
import { listRecipes } from "@/services/recipes";
import { AppHeader } from "@/components/app-header";
import { ShoppingListDetail } from "@/components/shopping-list-detail";
import { ArtifactDetail } from "@/components/artifact-detail";

export default async function ArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer(), { id } = await params;
  const artifact = await getArtifact(database(), viewer, id).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const recipeIds = new Set(artifact.content.kind === "grocery" ? shoppingRecipes(artifact.content).map((recipe) => recipe.recipeId) : []);
  const covers = recipeIds.size ? (await listRecipes(database(), viewer)).filter((recipe) => recipeIds.has(recipe.id)).map(({ id, coverPhotoId, coverSelection, coverImage, stockPhoto, tags }) => ({ id, coverPhotoId, coverSelection, coverImage, stockPhoto, tags })) : [];
  return <><AppHeader name={viewer.name} mode="shop" />{artifact.kind === "grocery" ? <ShoppingListDetail key={artifact.id} initial={artifact} covers={covers} /> : <ArtifactDetail key={artifact.id} initial={artifact} />}</>;
}
