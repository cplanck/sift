"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Settings2 } from "lucide-react";
import { clearOfflineData } from "@/lib/offline";
import { authClient } from "@/lib/auth-client";
import { ThemeToggle } from "./providers";
import { Button } from "./ui/button";
import { useSiftSettings, useSiftVoice } from "./assistant-shell";
import { AccountAvatar } from "./account-avatar";
import { ProductionSyncButton } from "./production-sync-button";
export function AccountMenu({ name, allowProductionSync = false }: { name: string; allowProductionSync?: boolean }) {
  const [error, setError] = useState("");
  const router = useRouter();
  const openSettings = useSiftSettings(), voice = useSiftVoice();
  return <div className="flex items-center gap-2"><details className="relative">
    <summary aria-label="Your account" className="flex size-11 cursor-pointer list-none items-center justify-center rounded-full hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"><AccountAvatar name={name} /></summary>
    <div className="absolute right-0 top-14 z-20 w-64 rounded-2xl border bg-background p-4 shadow-xl"><div className="mb-4 flex items-center gap-3"><AccountAvatar name={name} /><p className="truncate text-sm font-medium">{name}</p></div>
      <div className="mb-2"><ThemeToggle showLabel />{allowProductionSync && <ProductionSyncButton />}</div>
      <Button asChild variant="ghost" className="mb-2 w-full justify-start"><Link href="/settings"><Settings2 />User settings</Link></Button>
      {openSettings && <Button variant="ghost" className="mb-2 w-full justify-start" onClick={openSettings}><Settings2 />Sift settings</Button>}
      <Button variant="outline" className="w-full" onClick={async () => { try {
        if (voice?.busy) await voice.end();
        const result = await authClient.signOut();
        if (result.error) { setError("Couldn’t sign out. Try again."); return; }
        await clearOfflineData();
        router.replace("/"); router.refresh();
      } catch { setError("Couldn’t sign out. Check your connection."); } }}><LogOut />Sign out</Button>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div></details></div>;
}
