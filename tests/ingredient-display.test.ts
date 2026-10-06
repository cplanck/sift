import { expect, it } from "vitest";
import { ingredientName, scaleIngredient } from "@/domain/scaling";

it.each([
  ["½ cup broth", "broth"],
  ["1 14-oz can beans", "beans"],
  ["2 (14 oz) cans diced tomatoes", "diced tomatoes"],
  ["2–3 tbsp oil", "oil"],
  ["1 1/2 cups granulated sugar", "granulated sugar"],
  ["1 small onion, finely diced", "small onion"],
  ["6 bone-in, skin-on chicken thighs", "bone-in, skin-on chicken thighs"],
  ["Salt to taste", "Salt"],
  ["Baking soda", "Baking soda"],
  ["1/0 cup flour", "1/0 cup flour"],
])("makes a checklist label from %s without changing the original", (text, name) => {
  const ingredient = { text };
  expect(ingredientName(ingredient)).toBe(name);
  expect(scaleIngredient(ingredient, 1)).toBe(text);
});

it("uses structured names and removes prep notes and package amounts", () => {
  expect(ingredientName({ text: "1 (28 oz) can diced tomatoes", item: "diced tomatoes (28 oz)" })).toBe("diced tomatoes");
  expect(ingredientName({ text: "1 lemon, zested and juiced", item: "lemon, zested and juiced" })).toBe("lemon");
  expect(ingredientName({ text: "1 cup flour", item: " " })).toBe("flour");
});
