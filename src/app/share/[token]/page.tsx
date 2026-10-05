import type { Metadata } from "next";
import Image from "next/image";
import { cache } from "react";
import { notFound } from "next/navigation";
import { Clock3, Users } from "lucide-react";
import { database } from "@/db";
import { DomainError } from "@/domain/errors";
import { env } from "@/lib/env";
import { readSharedRecipe } from "@/services/shares";
import { Brand } from "@/components/brand";

export const dynamic = "force-dynamic";
const sharedRecipe = cache(async (token: string) => readSharedRecipe(database(), token).catch((error) => { if (error instanceof DomainError && error.code === "NOT_FOUND") notFound(); throw error; }));

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params, { content, coverPhotoId } = await sharedRecipe(token);
  const origin = new URL(env().BETTER_AUTH_URL).origin;
  const description = content.description || `A recipe for ${content.title}, shared from a personal cookbook on Sift.`;
  return {
    title: content.title, description,
    robots: { index: false, follow: false, noarchive: true, noimageindex: true }, referrer: "no-referrer",
    openGraph: { title: content.title, description, type: "article", siteName: "Sift", url: `${origin}/share/${token}`, ...(coverPhotoId ? { images: [{ url: `${origin}/share/${token}/image`, alt: content.title }] } : {}) },
    twitter: { card: coverPhotoId ? "summary_large_image" : "summary", title: content.title, description, ...(coverPhotoId ? { images: [`${origin}/share/${token}/image`] } : {}) },
  };
}

export default async function SharedRecipePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params, { content, coverPhotoId } = await sharedRecipe(token);
  const total = content.totalMinutes ?? ((content.prepMinutes ?? 0) + (content.cookMinutes ?? 0) || null);
  return <div className="mx-auto max-w-5xl px-5 pb-20 md:px-8"><header className="flex min-h-24 items-center justify-between gap-4 border-b"><Brand /><span className="text-xs text-muted-foreground sm:text-sm">From a personal cookbook</span></header>
    <main id="main" className="pt-8 md:pt-12">
      {coverPhotoId && <div className="relative mb-9 aspect-[4/3] max-h-[440px] overflow-hidden rounded-2xl bg-muted sm:aspect-[16/7]"><Image src={`/share/${token}/image`} fill unoptimized alt={content.title} className="object-cover" /></div>}
      <p className="mb-4 text-xs font-medium uppercase tracking-[.16em] text-muted-foreground">A recipe to keep</p><h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-[-.04em] md:text-5xl">{content.title}</h1>
      {content.description && <p className="mt-5 max-w-2xl whitespace-pre-wrap text-lg leading-relaxed text-muted-foreground">{content.description}</p>}
      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground"><span className="inline-flex items-center gap-2"><Users className="size-4" />{content.yieldText || `${content.servings} servings`}</span>{total !== null && <span className="inline-flex items-center gap-2"><Clock3 className="size-4" />{total} min total</span>}{content.prepMinutes !== null && <span>Prep {content.prepMinutes} min</span>}{content.cookMinutes !== null && <span>Cook {content.cookMinutes} min</span>}</div>
      <div className="mt-10 grid gap-10 border-t pt-8 md:mt-12 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:gap-12 md:pt-10"><section aria-labelledby="ingredients-heading"><h2 id="ingredients-heading" className="mb-6 text-xl font-medium">Ingredients</h2>{content.ingredientSections.map((section, index) => <div key={index} className="mb-7">{section.name && <h3 className="mb-3 text-sm font-semibold">{section.name}</h3>}<ul className="divide-y">{section.items.map((item, index) => <li key={index} className="py-3 leading-relaxed">{item.text}</li>)}</ul></div>)}</section>
        <section aria-labelledby="instructions-heading"><h2 id="instructions-heading" className="mb-6 text-xl font-medium">Instructions</h2>{content.instructionSections.map((section, sectionIndex) => <div key={sectionIndex} className="mb-8">{section.name && <h3 className="mb-5 text-sm font-semibold">{section.name}</h3>}<ol className="space-y-7">{section.steps.map((step, index) => <li key={index} className="flex gap-4"><span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full border text-sm text-muted-foreground">{index + 1}</span><p className="whitespace-pre-wrap pt-0.5 leading-relaxed">{step}</p></li>)}</ol></div>)}</section>
      </div>
    </main><footer className="mt-10 border-t pt-6 text-xs leading-relaxed text-muted-foreground">Shared with Sift. This is a saved version of the recipe, available to anyone with its link.</footer>
  </div>;
}
