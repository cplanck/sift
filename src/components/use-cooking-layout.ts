"use client";

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useGroupRef, type GroupProps } from "react-resizable-panels";
import { COOKING_LAYOUT_COOKIE, defaultCookingLayouts, type CookingLayoutPreference, type CookingPanelLayout, type CookingViewport } from "@/lib/cooking-layout";

const queries = ["(min-width: 640px)", "(min-width: 1024px)"];
function subscribe(listener: () => void) {
  const media = queries.map((query) => window.matchMedia(query));
  media.forEach((query) => query.addEventListener("change", listener));
  return () => media.forEach((query) => query.removeEventListener("change", listener));
}
const snapshot = (): CookingViewport => window.matchMedia(queries[1]).matches ? "wide" : window.matchMedia(queries[0]).matches ? "tablet" : "phone";

function save(preference: CookingLayoutPreference) {
  document.cookie = `${COOKING_LAYOUT_COOKIE}=${encodeURIComponent(JSON.stringify(preference))}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

export function useCookingLayout(initial: CookingLayoutPreference) {
  const viewport = useSyncExternalStore(subscribe, snapshot, () => initial.viewport);
  const preference = useRef(initial);
  const previousViewport = useRef(initial.viewport);
  const groupRef = useGroupRef();
  const defaultLayout = initial.layouts[viewport] ?? defaultCookingLayouts[viewport];

  useLayoutEffect(() => {
    let restore: number | undefined;
    if (previousViewport.current !== viewport) {
      // Let the panels register their new constraints before restoring this
      // viewport; otherwise the outgoing portrait maxSize=0 clamps Sift shut.
      restore = requestAnimationFrame(() => {
        groupRef.current?.setLayout(preference.current.layouts[viewport] ?? defaultCookingLayouts[viewport]);
      });
      previousViewport.current = viewport;
    }
    preference.current = { ...preference.current, viewport };
    save(preference.current);
    return () => { if (restore !== undefined) cancelAnimationFrame(restore); };
  }, [groupRef, viewport]);

  const onLayoutChanged: GroupProps["onLayoutChanged"] = (layout, meta) => {
    // Mounting and viewport constraints must not overwrite a user's saved sizes.
    if (!meta.isUserInteraction) return;
    const sizes = (meta.requestedLayout ?? layout) as CookingPanelLayout;
    preference.current = { viewport, layouts: { ...preference.current.layouts, [viewport]: sizes } };
    save(preference.current);
  };

  return { viewport, groupRef, defaultLayout, onLayoutChanged };
}
