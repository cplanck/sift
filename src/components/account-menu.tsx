"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Settings2, UserRound } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { ThemeToggle } from "./providers";
import { Button } from "./ui/button";
import { useSiftSettings } from "./assistant-shell";
export function AccountMenu({ name }: { name: string }) {
  const [error, setError] = useState("");
  const router = useRouter();
  const openSettings = useSiftSettings();
  return <div className="flex items-center gap-2"><ThemeToggle /><details className="relative">
    <summary aria-label="Your account" className="flex size-11 list-none items-center justify-center rounded-full border hover:bg-muted focus-visible:outline-2"><UserRound size={18} /></summary>
    <div className="absolute right-0 top-14 z-20 w-64 rounded-2xl border bg-background p-4 shadow-xl"><p className="mb-3 truncate text-sm">{name}</p>
      {openSettings && <Button variant="ghost" className="mb-2 w-full justify-start" onClick={openSettings}><Settings2 />Sift settings</Button>}
      <Button variant="outline" className="w-full" onClick={async () => { try {
        const result = await authClient.signOut();
        if (result.error) { setError("Couldn’t sign out. Try again."); return; }
        router.replace("/"); router.refresh();
      } catch { setError("Couldn’t sign out. Check your connection."); } }}><LogOut />Sign out</Button>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div></details></div>;
}
