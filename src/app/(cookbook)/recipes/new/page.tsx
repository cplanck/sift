import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { NewRecipeForm } from "@/components/new-recipe";
import { requireViewer } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function NewRecipe() {
  const viewer = await requireViewer();
  return <><AppHeader name={viewer.name} /><main id="main" className="mx-auto max-w-xl px-5 py-6 md:py-10"><Link href="/library" className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><ArrowLeft size={16} />All recipes</Link><h1 className="text-2xl font-semibold tracking-tight">Add recipe</h1><p className="mt-3 text-muted-foreground">Keep something worth making again.</p><NewRecipeForm /></main></>;
}
