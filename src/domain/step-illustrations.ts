import type { RecipeContent } from "./recipe";
export const COOKING_ACTIONS = ["whisk", "stir", "chop", "slice", "sauté", "simmer", "boil", "bake", "drain", "knead", "rest", "plate"] as const;
export type CookingAction = typeof COOKING_ACTIONS[number];
const actions: [CookingAction, RegExp][] = [
  ["whisk", /\bwhisk\b/i], ["stir", /\bstir\b/i], ["chop", /\b(?:chop|dice|mince)\b/i],
  ["slice", /\bslice\b/i], ["sauté", /\b(?:saut[eé]|fry|sear)\b/i], ["simmer", /\bsimmer\b/i],
  ["boil", /\bboil\b/i], ["bake", /\b(?:bake|roast)\b/i], ["drain", /\bdrain\b/i],
  ["knead", /\bknead\b/i], ["rest", /\b(?:rest(?! of)|cool)\b/i], ["plate", /\b(?:plate|serve|garnish)\b/i],
];


export function chooseStepIllustration(text: string): CookingAction | null {
  const normalized = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const title = normalized.match(/^([^:\n.!?]{1,80}):\s+/)?.[1];
  const titleMatches = title ? actions.filter(([, pattern]) => pattern.test(title)) : [];
  const matches = titleMatches.length ? titleMatches : actions.filter(([, pattern]) => pattern.test(normalized));
  return matches.length === 1 ? matches[0][0] : null;
}
export function withStepIllustrations(content: RecipeContent): RecipeContent {
  return { ...content, instructionSections: content.instructionSections.map((section) => ({ ...section, illustrationKeys: section.steps.map(chooseStepIllustration) })) };
}
