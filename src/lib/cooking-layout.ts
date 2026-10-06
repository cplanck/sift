export const COOKING_LAYOUT_COOKIE = "sift-cooking-layout-v1";
export type CookingViewport = "wide" | "tablet" | "phone";
export type CookingPanelLayout = Record<"cooking-steps" | "cooking-instruction" | "cooking-assistant", number>;
export type CookingLayoutPreference = { viewport: CookingViewport; layouts: Partial<Record<CookingViewport, CookingPanelLayout>> };

export const defaultCookingLayouts: Record<CookingViewport, CookingPanelLayout> = {
  wide: { "cooking-steps": 21, "cooking-instruction": 50, "cooking-assistant": 29 },
  tablet: { "cooking-steps": 26, "cooking-instruction": 74, "cooking-assistant": 0 },
  phone: { "cooking-steps": 30, "cooking-instruction": 70, "cooking-assistant": 0 },
};

export function parseCookingLayoutCookie(value?: string): CookingLayoutPreference {
  const fallback: CookingLayoutPreference = { viewport: "wide", layouts: {} };
  if (!value || value.length > 3000) return fallback;
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    if (!parsed || !["wide", "tablet", "phone"].includes(parsed.viewport)) return fallback;
    const layouts: CookingLayoutPreference["layouts"] = {};
    for (const viewport of ["wide", "tablet", "phone"] as const) {
      const candidate = parsed.layouts?.[viewport];
      if (!candidate || typeof candidate !== "object") continue;
      const values = Object.keys(defaultCookingLayouts.wide).map((id) => candidate[id]);
      if (values.some((size) => typeof size !== "number" || !Number.isFinite(size) || size < 0 || size > 100)) continue;
      if (Math.abs(values.reduce((sum, size) => sum + size, 0) - 100) > 0.1) continue;
      if (values[0] <= 0 || values[1] <= 0 || (viewport !== "wide" && values[2] !== 0)) continue;
      layouts[viewport] = { "cooking-steps": values[0], "cooking-instruction": values[1], "cooking-assistant": values[2] };
    }
    return { viewport: parsed.viewport, layouts };
  } catch { return fallback; }
}
