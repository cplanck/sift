import { requireViewer } from "@/lib/auth";
import { AssistantShell } from "@/components/assistant-shell";

export default async function CookbookLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  return <AssistantShell key={`${viewer.userId}:${viewer.workspaceId}`}>{children}</AssistantShell>;
}
