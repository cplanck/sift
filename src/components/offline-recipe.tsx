"use client";

import { useEffect } from "react";
import { cacheOfflineRecipe, type OfflineRecipeInput } from "@/lib/offline";
import { useOfflineIdentity } from "./offline-provider";

/** Explicit structured snapshots only; authenticated pages/APIs stay uncached. */
export function OfflineRecipeSnapshot({ snapshot }: { snapshot: OfflineRecipeInput }) {
  const identity = useOfflineIdentity(), serialized = JSON.stringify(snapshot);
  useEffect(() => {
    if (!identity) return;
    const controller = new AbortController();
    void cacheOfflineRecipe(identity, JSON.parse(serialized), controller.signal).catch(() => { /* Private/quota-limited browsing remains usable online. */ });
    return () => controller.abort();
  }, [identity, serialized]);
  return null;
}
