import { describe, expect, it } from "vitest";
import { parseIngredient, scaleIngredient } from "@/domain/scaling";
import { searchLibrary, type RecipeSummary } from "@/domain/recipe";
import { textSections } from "@/domain/recipe-text";

describe("lossless quantities and deterministic scaling", () => {
  it.each([
    ["½ cup flour", "1 cup flour"], ["2–3 tbsp oil", "4–6 tbsp oil"],
    ["1 14-oz can beans", "2 14-oz can beans"], ["to taste", "to taste"],
    ["2 large eggs", "4 large eggs"], ["1½ tsp salt", "3 tsp salt"],
    ["1 1/2 cups milk", "3 cups milk"], ["⅓ cup rice", "⅔ cup rice"],
  ])("scales %s without altering the original", (text, expected) => {
    const ingredient = parseIngredient(text);
    expect(scaleIngredient(ingredient, 2)).toBe(expected);
    expect(ingredient.text).toBe(text);
  });
  it("keeps ambiguous or invalid quantities as original text", () => {
    expect(scaleIngredient(parseIngredient("1/0 cup flour"), 2)).toBe("1/0 cup flour");
    expect(scaleIngredient(parseIngredient("3–2 tbsp oil"), 2)).toBe("3–2 tbsp oil");
  });
  it("preserves ingredient and instruction section names", () => {
    expect(textSections("[Sauce]\n½ cup cream\n[To finish]\nSalt to taste")).toEqual([{ name: "Sauce", lines: ["½ cup cream"] }, { name: "To finish", lines: ["Salt to taste"] }]);
  });
});

it("ranks title exact, prefix, substring, tags, ingredients, then notes", () => {
  const base: RecipeSummary = { id: "", versionId: "", title: "", description: "", tags: [], collections: [], ingredientsText: "", notesText: "", totalMinutes: null, status: "active", favorite: false, planned: false, updatedAt: "2026-01-01", coverPhotoId: null };
  const values = [
    { id: "notes", title: "Soup", notesText: "Turkey was good" },
    { id: "ingredient", title: "Meatballs", ingredientsText: "1 lb turkey" },
    { id: "tag", title: "Chili", tags: ["turkey"] },
    { id: "substring", title: "Roasted turkey" },
    { id: "prefix", title: "Turkey chili" }, { id: "exact", title: "Turkey" },
  ].map((r) => ({ ...base, ...r }));
  expect(searchLibrary(values, "turkey").map((r) => r.id)).toEqual(["exact", "prefix", "substring", "tag", "ingredient", "notes"]);
  expect(searchLibrary(values, "tu")[0].id).toBe("exact");
  expect(searchLibrary(values, "absent")).toEqual([]);
});
