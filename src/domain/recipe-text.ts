import { parseIngredient } from "./scaling";
import type { RecipeContent } from "./recipe";

export function textSections(text: string) {
  const sections: { name: string; lines: string[] }[] = [];
  let current = { name: "", lines: [] as string[] };
  for (const line of text.split("\n").map((line) => line.trim()).filter(Boolean)) {
    if (/^\[.+\]$/.test(line)) {
      if (current.lines.length) sections.push(current);
      current = { name: line.slice(1, -1), lines: [] };
    } else current.lines.push(line);
  }
  if (current.lines.length) sections.push(current);
  return sections;
}

export function contentFromForm(data: FormData): RecipeContent {
  const minutes = (key: string) => data.get(key) ? Number(data.get(key)) : null;
  return {
    title: String(data.get("title") ?? ""), description: String(data.get("description") ?? ""),
    servings: Number(data.get("servings") || 4), yieldText: String(data.get("yieldText") ?? ""),
    prepMinutes: minutes("prepMinutes"), cookMinutes: minutes("cookMinutes"), totalMinutes: null,
    ingredientSections: textSections(String(data.get("ingredients") ?? "")).map((section) => ({ name: section.name, items: section.lines.map(parseIngredient) })),
    instructionSections: textSections(String(data.get("instructions") ?? "")).map((section) => ({ name: section.name, steps: section.lines })),
    tags: String(data.get("tags") ?? "").split(",").map((s) => s.trim()).filter(Boolean), collections: [],
  };
}
