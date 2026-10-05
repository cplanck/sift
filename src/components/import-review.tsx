"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import type { importReview } from "@/services/imports";
import { api } from "@/lib/client-http";
import { RecipeForm } from "./recipe-form";
import { RecipeSourceInfo } from "./recipe-source";
import { Button } from "./ui/button";

type Review = Awaited<ReturnType<typeof importReview>>;
export function ImportReview({ initial }: { initial: Review }) {
  const [review, setReview] = useState(initial), [error, setError] = useState("");
  const router = useRouter();
  useEffect(() => {
    if (review.status === "saved" && review.recipe) { router.replace(`/recipes/${review.recipe.id}`); return; }
    if (!["queued", "processing"].includes(review.status)) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api<Review>(`/api/imports/${review.id}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setReview(result); setError("");
        if (["queued", "processing"].includes(result.status)) timer = setTimeout(poll, 2500);
      } catch {
        if (!controller.signal.aborted) { setError("Couldn’t check this import. Reconnecting automatically; your draft is safe."); timer = setTimeout(poll, 5000); }
      }
    }
    timer = setTimeout(poll, 1500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [review.id, review.status, review.recipe, router]);
  return <main id="main" className="mx-auto max-w-2xl px-5 py-10 md:py-14"><Link href="/library" className="mb-8 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><ArrowLeft size={16} />All recipes</Link>
    <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{review.status === "review" ? "Review your recipe." : review.status === "failed" ? "This import needs another try." : "Bringing your recipe in."}</h1>
    {review.status === "review" && review.recipe ? <><p className="mt-4 leading-relaxed text-muted-foreground">Check the ingredients and steps, make any corrections, then save it to your Library.</p><div className="mt-6 rounded-xl border p-4"><RecipeSourceInfo source={review.recipe.source} showOriginal /></div><RecipeForm key={review.recipe.version.id} initialContent={review.recipe.version.content} expectedVersionId={review.recipe.version.id} importId={review.id} /></>
      : review.status === "failed" ? <div className="mt-8 space-y-6"><p role="alert" className="leading-relaxed text-muted-foreground">{review.errorMessage || "Sift couldn’t read this recipe. Try pasting the recipe text or uploading a clearer photo."}</p><Button asChild><Link href="/recipes/new">Try another import</Link></Button></div>
      : <div className="mt-8 rounded-2xl border p-6"><div role="status" className="flex items-center gap-3"><LoaderCircle className="size-5 animate-spin" /><p>{review.status === "queued" ? "Waiting to read your recipe…" : review.status === "saved" ? "Opening your saved recipe…" : "Reading the ingredients and instructions…"}</p></div><p className="mt-4 text-sm leading-relaxed text-muted-foreground">You can leave this page. Your import will be waiting in the Library when it’s ready to review.</p></div>}
    {error && <p role="alert" className="mt-5 text-sm text-destructive">{error}</p>}
  </main>;
}
