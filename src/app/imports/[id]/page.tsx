import { notFound } from "next/navigation";
import { database } from "@/db";
import { requireViewer } from "@/lib/auth";
import { DomainError } from "@/domain/errors";
import { importReview } from "@/services/imports";
import { AppHeader } from "@/components/app-header";
import { ImportReview } from "@/components/import-review";

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  const review = await importReview(database(), viewer, (await params).id).catch((error) => { if (error instanceof DomainError && error.code === "NOT_FOUND") notFound(); throw error; });
  return <><AppHeader name={viewer.name} /><ImportReview initial={review} /></>;
}
