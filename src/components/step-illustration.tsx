"use client";
import Image from "next/image";
import { useState } from "react";
import artwork from "@/assets/cooking-illustrations.json";
import { type CookingAction } from "@/domain/step-illustrations";
export type { CookingAction } from "@/domain/step-illustrations";

export { cookingStepPresentation } from "@/domain/cooking-step-presentation";

export function StepIllustration({ action, text = "" }: { action: CookingAction | null; text?: string }) {
  const [failedAsset, setFailedAsset] = useState<string | null>(null);
  // All cooking illustrations are generated raster assets. Unsupported actions
  // and failed loads render no artwork; there is no SVG fallback.
  const noodleStep = /^(?:fry|stir[- ]fry|toss)\b[^:.!?\n]{0,45}\bnoodles\b/i.test(text.trim());
  const asset = action === "sauté" && noodleStep
    ? artwork.assets.find((item) => item.key === "toss-noodles-v1")
    : artwork.assets.find((item) => item.action === action && item.subject === "default");
  if (!asset || failedAsset === asset.src) return null;
  return <Image src={asset.src} width={320} height={320} sizes="(max-width: 639px) 160px, 280px" alt="" aria-hidden="true" className="object-contain" onError={() => setFailedAsset(asset.src)} />;
}
