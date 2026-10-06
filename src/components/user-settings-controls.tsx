"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Settings2 } from "lucide-react";
import { useSiftSettings } from "./assistant-shell";
import { Button } from "./ui/button";

export function UserSettingsControls() {
  const openSettings = useSiftSettings(), router = useRouter();
  const [refreshing, startTransition] = useTransition();
  return <div className="flex flex-wrap gap-2">
    <Button variant="outline" onClick={openSettings}><Settings2 />Sift settings</Button>
    <Button variant="outline" disabled={refreshing} onClick={() => startTransition(() => router.refresh())}><RefreshCw className={refreshing ? "animate-spin" : ""} />{refreshing ? "Refreshing…" : "Refresh usage"}</Button>
  </div>;
}
