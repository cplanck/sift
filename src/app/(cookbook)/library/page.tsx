import { requireViewer } from "@/lib/auth";
import { LibraryView } from "@/components/library";
import { database } from "@/db";
import { listActiveCookingSessions } from "@/services/cooking";
import { listRecipes } from "@/services/recipes";
import { listPendingImports } from "@/services/imports";
import { listArtifacts } from "@/services/artifacts";
import { productionSyncAllowed } from "@/lib/dev-production-sync";
export const dynamic = "force-dynamic";
export default async function Library({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode: requestedMode } = await searchParams;
  const mode = requestedMode === "plan" ? "shop" : requestedMode === "shop" || requestedMode === "cook" ? requestedMode : "home";
  const viewer = await requireViewer();
  const [recipes, imports, artifacts, activeCooks] = await Promise.all([listRecipes(database(), viewer), listPendingImports(database(), viewer), listArtifacts(database(), viewer), listActiveCookingSessions(database(), viewer)]);
  return <LibraryView key={mode} mode={mode} activeCooks={activeCooks} name={viewer.name} initialRecipes={recipes} initialImports={imports} recentArtifacts={artifacts} allowProductionSync={await productionSyncAllowed(viewer.workspaceId)} />;
}
