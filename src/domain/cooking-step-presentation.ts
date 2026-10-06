import { chooseStepIllustration, type CookingAction } from "./step-illustrations";

function inferredTitle(text: string) {
  const first = text.trim().replace(/^(?:meanwhile|next|then|finally)[,:]?\s+/i, "").replace(/^(?:in|using|once|when|after|before|while)\b[^,]*,\s*/i, "");
  const patterns: [RegExp, string][] = [
    [/^preheat\b/i, "Preheat the oven"],
    [/^(?:heat|warm)\b/i, "Heat the pan"],
    [/^bring\b.*\bboil\b/i, "Bring to a boil"],
    [/^(?:mix|combine|whisk|stir)\b.*\b(?:sauce|dressing|marinade)\b/i, "Mix the sauce"],
    [/^whisk\b/i, "Whisk together"],
    [/^(?:mix|combine|stir)\b/i, "Mix the ingredients"],
    [/^(?:chop|dice|mince|slice|cut|peel|grate|trim)\b/i, "Prep the ingredients"],
    [/^soak\b/i, "Soak the ingredients"],
    [/^drain\b/i, "Drain the ingredients"],
    [/^rinse\b/i, "Rinse the ingredients"],
    [/^(?:season|marinate|rub)\b/i, "Season the ingredients"],
    [/^(?:sauté|saute|fry|sear|brown)\b/i, "Cook in the pan"],
    [/^simmer\b/i, "Simmer gently"],
    [/^bake\b/i, "Bake until ready"],
    [/^roast\b/i, "Roast until ready"],
    [/^knead\b/i, "Knead the dough"],
    [/^rest\b/i, "Let it rest"],
    [/^(?:cool|chill|refrigerate)\b/i, "Let it cool"],
    [/^cover\b.*\bcook\b/i, "Cover and cook"],
    [/^taste\b/i, "Taste and season"],
    [/^(?:serve|garnish|plate|top)\b/i, "Finish and serve"],
  ];
  // Prefer a short action phrase from the recipe before a generic action title.
  const phrase = first.split(/[,;.!?]|\s+(?:until|for|in|into|over|with|to|and then)\s+/i)[0].trim();
  if (phrase.split(/\s+/).length >= 2 && phrase.length <= 42 && !/^(?:if|once|when|after|before|while)\b/i.test(phrase)) return phrase.charAt(0).toUpperCase() + phrase.slice(1);
  return patterns.find(([pattern]) => pattern.test(first))?.[1] ?? "Prepare this step";
}

export function cookingStepPresentation(text: string, _section: string | null, illustrationKey?: CookingAction | null) {
  const action = illustrationKey === undefined ? chooseStepIllustration(text) : illustrationKey;
  const titled = text.match(/^([^:\n.!?]{1,80}):\s+(\S[\s\S]*)$/);
  const candidate = text.match(/^(.{1,48}?[.!?])(?:\s+([\s\S]*))?$/);
  const sentence = candidate && candidate[1].split(/\s+/).length <= 6 ? candidate : null;
  const heading = titled?.[1].trim() ?? sentence?.[1].trim().replace(/[.!?]$/, "") ?? inferredTitle(text);
  const remainder = titled?.[2] ?? sentence?.[2] ?? (sentence ? "" : text);
  const instruction = titled ? remainder.charAt(0).toUpperCase() + remainder.slice(1) : remainder;
  return { action, label: heading, heading, instruction };
}
