import { requireViewer } from "@/lib/auth";
import { OfflineProvider } from "@/components/offline-provider";
import { AssistantShell } from "@/components/assistant-shell";

export default async function CookbookLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  return <OfflineProvider key={`${viewer.userId}:${viewer.workspaceId}`} scope={{ userId: viewer.userId, workspaceId: viewer.workspaceId, sessionExpiresAt: viewer.sessionExpiresAt }}><AssistantShell>{children}</AssistantShell></OfflineProvider>;
}
