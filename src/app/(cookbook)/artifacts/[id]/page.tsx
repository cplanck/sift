import { notFound } from "next/navigation";
import { database } from "@/db";
import { DomainError } from "@/domain/errors";
import { requireViewer } from "@/lib/auth";
import { getArtifact } from "@/services/artifacts";
import { AppHeader } from "@/components/app-header";
import { ArtifactDetail } from "@/components/artifact-detail";

export default async function ArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer(), { id } = await params;
  const artifact = await getArtifact(database(), viewer, id).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  return <><AppHeader name={viewer.name} /><ArtifactDetail key={artifact.id} initial={artifact} /></>;
}
