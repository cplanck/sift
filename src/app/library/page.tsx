import { requireViewer } from "@/lib/auth";
import { LibraryView } from "@/components/library";
import { database } from "@/db";
import { listRecipes } from "@/services/recipes";
export const dynamic = "force-dynamic";
export default async function Library() {
  const viewer = await requireViewer();
  return <LibraryView name={viewer.name} initialRecipes={await listRecipes(database(), viewer)} />;
}
