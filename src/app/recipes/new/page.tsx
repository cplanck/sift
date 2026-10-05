import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { RecipeForm } from "@/components/recipe-form";
import { requireViewer } from "@/lib/auth";
export default async function NewRecipe() {
  const viewer = await requireViewer();
  return <><AppHeader name={viewer.name} /><main id="main" className="mx-auto max-w-2xl px-5 py-10 md:py-14"><Link href="/library" className="mb-8 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><ArrowLeft size={16} />All recipes</Link><h1 className="text-4xl font-medium tracking-tight">Add a keeper.</h1><p className="mt-3 text-muted-foreground">A recipe worth coming back to.</p><RecipeForm /></main></>;
}
