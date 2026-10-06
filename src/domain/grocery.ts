import type { ArtifactContent, ArtifactDetail } from "./artifact";
import { formatQuantity, ingredientMeasure, ingredientName, parseIngredient } from "./scaling";

type GroceryContent = Extract<ArtifactContent, { kind: "grocery" }>;
type GroceryItem = GroceryContent["groups"][number]["items"][number];

const unitAliases: [RegExp, string][] = [
  [/^(?:tablespoons?|tbsp\.?)$/i, "tbsp"], [/^(?:teaspoons?|tsp\.?)$/i, "tsp"], [/^cups?$/i, "cup"], [/^(?:ounces?|oz\.?)$/i, "oz"],
  [/^(?:pounds?|lbs?\.?)$/i, "lb"], [/^(?:grams?|g)$/i, "g"], [/^(?:kilograms?|kg)$/i, "kg"], [/^(?:milliliters?|millilitres?|ml)$/i, "ml"], [/^(?:liters?|litres?|l)$/i, "l"],
];
const unitKey = (unit: string | null) => unit === null ? "" : unitAliases.find(([pattern]) => pattern.test(unit))?.[1] ?? unit.toLowerCase().replace(/e?s$/, "");
const nameKey = (text: string) => ingredientName({ text }).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().replace(/(?<=\p{L})e?s$/u, "");

// Merges lines that name the same ingredient in the same unit ("2 onions" + "1 onion" → "3 onions").
// Anything ambiguous — ranges, different units, package sizes — stays as its own line.
export function combineGroceryItems(content: GroceryContent, newId: () => string): GroceryContent {
  const merged = new Map<string, { item: GroceryItem; value: number | null; amountLength: number; count: number; checked: boolean; sources: NonNullable<GroceryItem["sources"]> }>();
  for (const item of content.groups.flatMap((group) => group.items)) {
    const measure = ingredientMeasure(item.text);
    const sources = item.sources ?? (item.source ? [{ ...item.source, text: item.text }] : []);
    const key = `${content.recipes ? sources.length ? "recipe|" : "manual|" : ""}${measure ? `${nameKey(item.text)}|${unitKey(measure.unit)}` : parseIngredient(item.text).quantity ? `unique|${item.id}` : `${nameKey(item.text)}|?`}`;
    const existing = merged.get(key);
    if (!existing) { merged.set(key, { item, value: measure?.value ?? null, amountLength: measure?.amountLength ?? 0, count: 1, checked: item.checked, sources: [...sources] }); continue; }
    if (!existing.item.category && item.category) existing.item = { ...existing.item, category: item.category };
    existing.count++; existing.checked &&= item.checked;
    existing.sources.push(...sources);
    if (existing.value !== null && measure) {
      existing.value += measure.value;
      // Prefer a line already written for more than one ("2 lemons") so the total reads naturally.
      if (measure.value > 1 && (ingredientMeasure(existing.item.text)?.value ?? 0) <= 1) Object.assign(existing, { item: { ...item, id: existing.item.id, category: existing.item.category ?? item.category }, amountLength: measure.amountLength });
    }
  }
  const items = [...merged.values()].map(({ item, value, amountLength, count, checked, sources }): GroceryItem => count === 1 ? item : {
    id: item.id, category: item.category, checked, text: value === null ? item.text : `${formatQuantity(value)}${item.text.trim().slice(amountLength)}`, ...(sources.length ? { sources } : {}),
  });
  return { ...content, groups: items.length ? [{ id: content.groups[0]?.id ?? newId(), name: "", items }] : [] };
}

export function shoppingRecipes(content: GroceryContent): NonNullable<GroceryContent["recipes"]> {
  if (content.recipes) return content.recipes;
  const found = new Map<string, NonNullable<GroceryContent["recipes"]>[number]>();
  for (const group of content.groups) for (const item of group.items) for (const source of item.sources ?? (item.source ? [item.source] : [])) {
    if (!found.has(source.recipeId)) found.set(source.recipeId, { recipeId: source.recipeId, versionId: source.versionId, servings: source.servings, title: group.name.split(" · ")[0] || "Saved recipe" });
  }
  return [...found.values()];
}

// Expand combined recipe ingredients before changing a recipe contribution.
// Manual items keep their identity and checkmarks throughout recomputation.
export function expandRecipeItems(content: GroceryContent, newId: () => string): GroceryContent {
  return { ...content, recipes: shoppingRecipes(content), groups: content.groups.map((group) => ({ ...group, items: group.items.flatMap((item) => item.sources?.length ? item.sources.map(({ text, ...source }, index) => ({ id: index === 0 ? item.id : newId(), text, checked: item.checked, category: item.category, source })) : [item]) })) };
}

// A Markdown checklist for notes apps. Items already checked off are left out by default.
export function groceryToMarkdown(artifact: Pick<ArtifactDetail, "title" | "content">, { includeChecked = false } = {}) {
  if (artifact.content.kind !== "grocery") return "";
  const lines = [`# ${artifact.title}`, ""];
  for (const group of artifact.content.groups) {
    const items = includeChecked ? group.items : group.items.filter((item) => !item.checked);
    if (!items.length) continue;
    if (group.name) lines.push(`## ${group.name}`, "");
    lines.push(...items.map((item) => `- [${item.checked ? "x" : " "}] ${item.text}`), "");
  }
  return lines.join("\n").trim() + "\n";
}
