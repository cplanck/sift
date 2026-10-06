import { requireViewer } from "@/lib/auth";
import { LibraryView } from "@/components/library";
import { database } from "@/db";
import { listRecipes } from "@/services/recipes";
import { listPendingImports } from "@/services/imports";
import { listArtifacts } from "@/services/artifacts";
import { productionSyncAllowed } from "@/lib/dev-production-sync";
export const dynamic = "force-dynamic";
export default async function Library() {
  const viewer = await requireViewer();
  const [recipes, imports, artifacts] = await Promise.all([listRecipes(database(), viewer), listPendingImports(database(), viewer), listArtifacts(database(), viewer)]);
  return <LibraryView name={viewer.name} initialRecipes={recipes} initialImports={imports} recentArtifacts={artifacts.slice(0, 4)} allowProductionSync={await productionSyncAllowed(viewer.workspaceId)} />;
}
