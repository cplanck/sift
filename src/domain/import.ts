import { z } from "zod";
import { load } from "cheerio";
import { recipeContentSchema, type RecipeContent } from "./recipe";
import { textSections } from "./recipe-text";
import { parseIngredient } from "./scaling";

export const importInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("paste"), text: z.string().trim().min(20).max(80000) }),
  z.object({ kind: z.literal("url"), url: z.url().max(2048) }),
  z.object({ kind: z.literal("image"), photoId: z.uuid() }),
]);

// Deterministic extraction is preferred when the source is already structured.
export function parsePastedRecipe(text: string): RecipeContent | null {
  try {
    const parsed = JSON.parse(text);
    const result = recipeContentSchema.safeParse(parsed);
    if (result.success) return result.data;
  } catch { /* Normal recipe text is not JSON. */ }
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const ingredientsIndex = lines.findIndex((line) => /^ingredients\s*:?(\s*)$/i.test(line));
  const methodIndex = lines.findIndex((line) => /^(instructions|directions|method)\s*:?(\s*)$/i.test(line));
  if (ingredientsIndex < 1 || methodIndex <= ingredientsIndex + 1 || methodIndex >= lines.length - 1) return null;
  const servingLine = lines.slice(1, ingredientsIndex).find((line) => /^(serves|servings|yield)\s*:?\s*\d/i.test(line));
  const servings = servingLine?.match(/\d+(?:\.\d+)?/)?.[0];
  const result = recipeContentSchema.safeParse({
    title: lines[0].replace(/^#+\s*/, ""), description: lines.slice(1, ingredientsIndex).filter((line) => line !== servingLine).join("\n"),
    servings: servings ? Number(servings) : 4, yieldText: servingLine ?? "",
    ingredientSections: textSections(lines.slice(ingredientsIndex + 1, methodIndex).join("\n")).map((section) => ({ name: section.name, items: section.lines.map((line) => parseIngredient(line.replace(/^[-*•]\s+/, ""))) })),
    instructionSections: textSections(lines.slice(methodIndex + 1).join("\n")).map((section) => ({ name: section.name, steps: section.lines.map((line) => line.replace(/^\d+[.)]\s+/, "")) })),
  });
  return result.success ? result.data : null;
}

function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function cleanText(value: unknown): string { return typeof value === "string" ? load(`<div>${value}</div>`)("div").text().trim() : ""; }
function duration(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  return match ? Number(match[1] || 0) * 1440 + Number(match[2] || 0) * 60 + Number(match[3] || 0) + Math.ceil(Number(match[4] || 0) / 60) : null;
}

export function extractRecipeHtml(html: string): { content: RecipeContent | null; text: string; imageUrl: string | null } {
  const $ = load(html);
  let imageUrl: string | null = null;
  const nodes: unknown[] = [];
  $("script[type='application/ld+json']").each((_, el) => { try { nodes.push(JSON.parse($(el).text())); } catch { /* Ignore malformed metadata and fall back to visible content. */ } });
  const visit = (value: unknown): RecipeContent | null => {
    if (Array.isArray(value)) { for (const item of value) { const result = visit(item); if (result) return result; } return null; }
    const item = record(value); if (!item) return null;
    if (item["@graph"]) { const result = visit(item["@graph"]); if (result) return result; }
    const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
    if (!types.some((type) => type === "Recipe" || type === "https://schema.org/Recipe")) return null;
    const instructions: RecipeContent["instructionSections"] = [];
    const entries = Array.isArray(item.recipeInstructions) ? item.recipeInstructions : [item.recipeInstructions];
    let steps: string[] = [];
    for (const entry of entries) {
      if (typeof entry === "string") steps.push(...entry.split(/\n+/).map(cleanText).filter(Boolean));
      else {
        const step = record(entry); if (!step) continue;
        if (Array.isArray(step.itemListElement)) {
          if (steps.length) { instructions.push({ name: "", steps }); steps = []; }
          instructions.push({ name: cleanText(step.name), steps: step.itemListElement.map((s) => cleanText(typeof s === "string" ? s : record(s)?.text)).filter(Boolean) });
        } else if (typeof step.text === "string") steps.push(cleanText(step.text));
      }
    }
    if (steps.length) instructions.push({ name: "", steps });
    const yieldValue = Array.isArray(item.recipeYield) ? item.recipeYield[0] : item.recipeYield;
    const yieldText = typeof yieldValue === "number" ? String(yieldValue) : cleanText(yieldValue);
    const parsed = recipeContentSchema.safeParse({
      title: cleanText(item.name), description: cleanText(item.description),
      servings: Number(yieldText.match(/\d+(?:\.\d+)?/)?.[0] ?? 4), yieldText,
      prepMinutes: duration(item.prepTime), cookMinutes: duration(item.cookTime), totalMinutes: duration(item.totalTime),
      ingredientSections: [{ name: "", items: Array.isArray(item.recipeIngredient) ? item.recipeIngredient.map((line) => parseIngredient(cleanText(line))).filter((i) => i.text) : [] }],
      instructionSections: instructions,
      tags: typeof item.keywords === "string" ? item.keywords.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 30) : [],
    });
    if (parsed.success) {
      const image = Array.isArray(item.image) ? item.image[0] : item.image;
      const candidate = typeof image === "string" ? image : record(image)?.url ?? record(image)?.contentUrl;
      imageUrl = typeof candidate === "string" && candidate.length <= 2000 ? candidate : null;
    }
    return parsed.success ? parsed.data : null;
  };
  const content = visit(nodes);
  $("script,style,nav,footer,header,iframe,noscript").remove();
  const text = ($("main").text() || $("article").text() || $("body").text()).replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim().slice(0, 80000);
  return { content, text, imageUrl };
}
