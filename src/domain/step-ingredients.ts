import type { RecipeContent } from "./recipe";

// Words that describe an ingredient rather than name it ("2 large ripe tomatoes, diced").
const descriptors = new Set([
  "a", "an", "the", "of", "and", "or", "for", "to", "taste", "plus", "more", "about", "optional", "divided", "each",
  "cup", "cups", "tablespoon", "tablespoons", "tbsp", "tbs", "teaspoon", "teaspoons", "tsp", "ounce", "ounces", "oz", "pound", "pounds", "lb", "lbs",
  "gram", "grams", "g", "kg", "kilogram", "ml", "milliliter", "milliliters", "l", "liter", "liters", "pinch", "dash", "can", "cans", "jar", "package", "packages",
  "bunch", "handful", "stick", "sticks", "piece", "pieces", "slice", "slices", "clove", "cloves", "sprig", "sprigs", "head", "heads", "inch", "quart", "pint",
  "small", "medium", "large", "extra", "big", "whole", "fresh", "freshly", "dried", "ripe", "raw", "cooked", "frozen", "thawed", "canned", "good", "quality",
  "chopped", "diced", "minced", "sliced", "grated", "shredded", "crushed", "ground", "peeled", "seeded", "trimmed", "halved", "quartered", "cubed",
  "finely", "roughly", "coarsely", "thinly", "lightly", "softened", "melted", "packed", "sifted", "beaten", "room", "temperature", "cold", "warm", "hot",
  "boneless", "skinless", "unsalted", "salted", "low", "sodium", "reduced", "fat", "free", "organic", "virgin", "kosher", "flaky", "fine", "coarse",
  "red", "green", "yellow", "white", "black", "brown", "golden", "light", "dark", "sweet",
]);
// Endings too generic to identify an ingredient on their own ("make the sauce").
const weakHeads = new Set(["sauce", "paste", "powder", "juice", "extract", "seed", "leaf", "flake", "zest", "mix", "mixture", "blend"]);
const generic = new Set(["ingredient", "ingredients", "main", "other", "everything", "base", "garnish", "serve", "serving"]);

function singular(word: string) {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(oes|ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}
const words = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^a-z\s-]/g, " ").split(/[\s-]+/).filter(Boolean).map(singular);

/** The words that name an ingredient: its item when given, else its text minus amount, notes and prep. */
function nameWords(ingredient: { text: string; item?: string }) {
  const source = (ingredient.item || ingredient.text).replace(/\([^)]*\)/g, " ").split(/[,;]| for /)[0];
  return words(source).filter((word) => !descriptors.has(word) && word.length > 1);
}

/**
 * Which ingredients a step uses, as "sectionIndex:itemIndex" keys in recipe order.
 * Deterministic and conservative: an ingredient matches when the step names it
 * (any distinctive word, or its head noun unless that head is generic like
 * "sauce"), or when the step names the ingredient section it belongs to
 * ("Make the sauce" picks up a "Sauce" section).
 */
export function stepIngredientKeys(content: Pick<RecipeContent, "ingredientSections">, step: { text: string; section?: string }) {
  const stepWords = new Set(words(`${step.section ?? ""} ${step.text}`));
  const stepPhrase = ` ${words(`${step.section ?? ""} ${step.text}`).join(" ")} `;
  const named: string[] = [], sections: string[] = [];
  content.ingredientSections.forEach((section, sectionIndex) => {
    const sectionName = words(section.name.replace(/^for (the )?/i, "")).filter((word) => !descriptors.has(word) && !generic.has(word));
    const wholeSection = sectionName.length > 0 && stepPhrase.includes(` ${sectionName.join(" ")} `);
    section.items.forEach((item, index) => {
      const key = `${sectionIndex}:${index}`, name = nameWords(item);
      if (wholeSection) sections.push(key);
      if (!name.length) return;
      const head = name.at(-1)!;
      const distinctive = name.filter((word) => !weakHeads.has(word) && word.length > 2);
      if (distinctive.some((word) => stepWords.has(word)) || (!weakHeads.has(head) && stepWords.has(head)) || (name.length > 1 && stepPhrase.includes(` ${name.join(" ")} `))) named.push(key);
    });
  });
  // A section name is a fallback for steps like "Make the sauce" that name no
  // ingredient themselves; "Soak the noodles" shouldn't pull in a Noodles section.
  return named.length ? named : sections;
}
