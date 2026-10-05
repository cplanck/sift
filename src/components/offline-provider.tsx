"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { activateOfflineScope, clearOfflineData, OFFLINE_CHANNEL, offlineIdentityIsCurrent, type OfflineIdentity, type OfflineScope } from "@/lib/offline";

const OfflineContext = createContext<OfflineIdentity | null>(null);
export const useOfflineIdentity = () => useContext(OfflineContext);

export function OfflineProvider({ scope, children }: { scope: OfflineScope; children: React.ReactNode }) {
  const [identity, setIdentity] = useState<OfflineIdentity | null>(null);
  const { userId, workspaceId, sessionExpiresAt } = scope;
  useEffect(() => {
    const controller = new AbortController();
    let active: OfflineIdentity | null = null, expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => { controller.abort(); setIdentity(null); if (expiryTimer) clearTimeout(expiryTimer); };
    async function verify() {
      if (controller.signal.aborted || !navigator.onLine) return;
      try {
        const response = await fetch("/api/offline/session", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (response.status === 401) { await clearOfflineData(); return; }
        if (!response.ok) return;
        const current: OfflineScope = await response.json();
        // A stale page cannot activate a previous account's local cache.
        if (current.userId !== userId || current.workspaceId !== workspaceId) { invalidate(); return; }
        const authenticated = { userId, workspaceId, sessionExpiresAt: new Date(Math.min(Date.parse(sessionExpiresAt), Date.parse(current.sessionExpiresAt))).toISOString() };
        active = await activateOfflineScope(authenticated, controller.signal);
        if (controller.signal.aborted || !active) return;
        setIdentity(active);
        if (expiryTimer) clearTimeout(expiryTimer);
        expiryTimer = setTimeout(() => { void clearOfflineData(); }, Math.max(0, active.expiresAt - Date.now()));
      } catch { /* IndexedDB and offline preparation are best-effort. */ }
    }
    const changed = (type: string) => {
      if (type === "cleared") { invalidate(); return; }
      if (active) void offlineIdentityIsCurrent(active).then((current) => { if (!current) invalidate(); }).catch(invalidate);
    };
    const localChange = (event: Event) => changed((event as CustomEvent<string>).detail);
    let channel: BroadcastChannel | null = null;
    try { if ("BroadcastChannel" in window) channel = new BroadcastChannel(OFFLINE_CHANNEL); } catch { /* Use storage events when channels are unavailable. */ }
    if (channel) channel.onmessage = (event) => changed(event.data?.type);
    const storageChange = (event: StorageEvent) => { if (event.key === OFFLINE_CHANNEL && event.newValue) { try { changed(JSON.parse(event.newValue).type); } catch { /* Ignore unrelated malformed browser state. */ } } };
    const visible = () => { if (document.visibilityState === "visible") void verify(); };
    window.addEventListener(OFFLINE_CHANNEL, localChange); window.addEventListener("storage", storageChange); window.addEventListener("online", verify); document.addEventListener("visibilitychange", visible);
    void verify();
    return () => {
      controller.abort(); if (expiryTimer) clearTimeout(expiryTimer); channel?.close();
      window.removeEventListener(OFFLINE_CHANNEL, localChange); window.removeEventListener("storage", storageChange); window.removeEventListener("online", verify); document.removeEventListener("visibilitychange", visible);
    };
  }, [userId, workspaceId, sessionExpiresAt]);
  return <OfflineContext.Provider value={identity}>{children}</OfflineContext.Provider>;
}
