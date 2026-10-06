import { describe, expect, it } from "vitest";
import { stepIngredientKeys } from "@/domain/step-ingredients";

const padThai = { ingredientSections: [
  { name: "Sauce", items: [{ text: "3 tbsp tamarind paste" }, { text: "2 tbsp fish sauce" }, { text: "2 tbsp brown sugar" }] },
  { name: "Noodles", items: [{ text: "8 oz rice noodles" }, { text: "2 tablespoons extra-virgin olive oil", item: "extra-virgin olive oil" }, { text: "3 garlic cloves, minced" }, { text: "2 large eggs" }, { text: "1 cup bean sprouts" }, { text: "1 lime, cut into wedges" }, { text: "Salt and freshly ground black pepper" }] },
] };
const names = (keys: string[]) => keys.map((key) => { const [s, i] = key.split(":").map(Number); return padThai.ingredientSections[s].items[i].text; });

describe("ingredients for one cooking step", () => {
  it("finds the sauce ingredients by name with amounts intact", () => {
    expect(names(stepIngredientKeys(padThai, { text: "Whisk together the tamarind, fish sauce, and sugar until the sugar dissolves." })))
      .toEqual(["3 tbsp tamarind paste", "2 tbsp fish sauce", "2 tbsp brown sugar"]);
  });
  it("uses the section name when a step refers to it", () => {
    expect(names(stepIngredientKeys(padThai, { text: "Make the sauce." }))).toEqual(["3 tbsp tamarind paste", "2 tbsp fish sauce", "2 tbsp brown sugar"]);
    expect(names(stepIngredientKeys(padThai, { section: "Sauce", text: "Stir well." }))).toHaveLength(3);
  });
  it("matches plurals, head nouns and ignores generic endings", () => {
    expect(names(stepIngredientKeys(padThai, { text: "Heat the oil, add the garlic, then crack in the egg." }))).toEqual(["2 tablespoons extra-virgin olive oil", "3 garlic cloves, minced", "2 large eggs"]);
    expect(names(stepIngredientKeys(padThai, { text: "Soak the noodles in hot water." }))).toEqual(["8 oz rice noodles"]);
    expect(stepIngredientKeys(padThai, { text: "Toss with the sauce and serve." })).toEqual(["0:0", "0:1", "0:2"]);
    expect(stepIngredientKeys(padThai, { text: "Bring a large pot to a boil." })).toEqual([]);
  });
  it("handles notes after commas and seasoning lines", () => {
    expect(names(stepIngredientKeys(padThai, { text: "Garnish with sprouts and lime." }))).toEqual(["1 cup bean sprouts", "1 lime, cut into wedges"]);
    expect(names(stepIngredientKeys(padThai, { text: "Season with salt to taste." }))).toEqual(["Salt and freshly ground black pepper"]);
  });
});
