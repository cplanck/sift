import type { Ingredient } from "./recipe";

const fractions: Record<string, number> = { "¼": 1 / 4, "½": 1 / 2, "¾": 3 / 4, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 1 / 8, "⅜": 3 / 8, "⅝": 5 / 8, "⅞": 7 / 8 };
const numberPattern = "(?:\\d+\\s+\\d+\\/\\d+|\\d+[¼½¾⅓⅔⅛⅜⅝⅞]|\\d+\\/\\d+|\\d+(?:\\.\\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])";
const amountPattern = new RegExp(`^(${numberPattern})(?:\\s*[–—-]\\s*(${numberPattern}))?(?=\\s|$)`);

function numberValue(input: string) {
  const last = input.at(-1)!;
  if (fractions[last]) return Number(input.slice(0, -1) || 0) + fractions[last];
  if (input.includes("/")) {
    const parts = input.split(/\s+/);
    const [numerator, denominator] = parts.at(-1)!.split("/").map(Number);
    return (parts.length > 1 ? Number(parts[0]) : 0) + numerator / denominator;
  }
  return Number(input);
}

export function parseIngredient(text: string): Ingredient {
  const original = text.trim();
  const match = original.match(amountPattern);
  if (!match) return { text: original };
  const min = numberValue(match[1]), max = match[2] ? numberValue(match[2]) : undefined;
  if (!Number.isFinite(min) || (max !== undefined && (!Number.isFinite(max) || max < min))) return { text: original };
  return { text: original, quantity: max === undefined ? { kind: "exact", value: min } : { kind: "range", min, max } };
}

export function formatQuantity(value: number) {
  const whole = Math.floor(value), fraction = value - whole;
  if (fraction < 0.0001) return String(whole);
  for (const [symbol, amount] of Object.entries(fractions)) if (Math.abs(amount - fraction) < 0.0001) return `${whole || ""}${symbol}`;
  return String(Math.round(value * 1000) / 1000);
}

const unitWords = "fluid ounces?|fl\\.? oz\\.?|tablespoons?|teaspoons?|tbsp\\.?|tsp\\.?|cups?|ounces?|oz\\.?|pounds?|lbs?\\.?|kilograms?|kg|grams?|g|milliliters?|millilitres?|ml|liters?|litres?|l|pints?|quarts?|gallons?|cans?|jars?|packages?|packets?|bunches|bunch|cloves?|slices?|pinches|pinch|handfuls?";
const leadingMeasure = new RegExp(`^(?:${unitWords})(?=\\s|$)\\s*(?:of\\s+)?`, "i");
const packageMeasure = new RegExp(`^\\(?${numberPattern}\\s*[-–]?\\s*(?:${unitWords})\\)?\\s+`, "i");
const parentheticalMeasure = new RegExp(`\\(\\s*${numberPattern}\\s*[-–]?\\s*(?:${unitWords})\\s*\\)`, "gi");

// The leading count and unit of an ingredient line, e.g. "1½ cups flour" → 1.5 "cups".
// Ranges, package sizes ("1 14-oz can") and unitless counts return a null unit.
export function ingredientMeasure(text: string): { value: number; unit: string | null; amountLength: number } | null {
  const trimmed = text.trim(), match = trimmed.match(amountPattern), parsed = parseIngredient(trimmed);
  if (!match || parsed.quantity?.kind !== "exact") return null;
  const unit = trimmed.slice(match[0].length).trimStart().match(new RegExp(`^(?:${unitWords})(?=\\s|$)`, "i"));
  return { value: parsed.quantity.value, unit: unit ? unit[0] : null, amountLength: match[0].length };
}

// A display-only label. Keep the original wording for quantities, alternatives,
// preparation instructions, scaling, and recipe history.
export function ingredientName(ingredient: Ingredient) {
  let name = ingredient.item?.trim();
  if (!name) {
    name = ingredient.text.trim();
    const amount = name.match(amountPattern);
    if (amount && parseIngredient(name).quantity) {
      name = name.slice(amount[0].length).trim();
      name = name.replace(packageMeasure, "").replace(/^(?:heaped|heaping|level|packed)\s+/i, "").replace(leadingMeasure, "");
    }
  }
  const concise = name
    .replace(parentheticalMeasure, "")
    .replace(/,\s*(?:(?:finely|roughly|thinly|freshly|coarsely)\s+)?(?:chopped|diced|minced|sliced|grated|drained|rinsed|peeled|crushed|torn|zested|juiced|softened|melted|divided|cut\b|plus\b|to taste\b|for serving\b).*$/i, "")
    .replace(/\s+(?:to taste|as needed|for serving|for garnish)\s*$/i, "")
    .replace(/\s{2,}/g, " ").trim();
  return concise || ingredient.text;
}

// Scaling is a view transformation: the immutable original text is always retained.
// Package sizes in "1 14-oz can" are part of the remainder, not the count.
export function scaleIngredient(ingredient: Ingredient, factor: number) {
  if (!Number.isFinite(factor) || factor <= 0) throw new RangeError("Scaling factor must be positive.");
  if (factor === 1) return ingredient.text;
  const parsed = parseIngredient(ingredient.text);
  const match = ingredient.text.match(amountPattern);
  if (!parsed.quantity || !match) return ingredient.text;
  const q = parsed.quantity;
  const scaled = q.kind === "range" ? `${formatQuantity(q.min * factor)}–${formatQuantity(q.max * factor)}` : formatQuantity(q.value * factor);
  return `${scaled}${ingredient.text.slice(match[0].length)}`;
}
