import { describe, expect, it } from "vitest";
import { completeCookingStep } from "@/domain/cooking";
import { cookingStepPresentation } from "@/domain/cooking-step-presentation";

describe("cooking step titles", () => {
  it("keeps an authored heading separate from its instruction", () => {
    expect(cookingStepPresentation("Fry the noodles: add noodles and toss until glossy.", "Directions")).toMatchObject({ heading: "Fry the noodles", instruction: "Add noodles and toss until glossy." });
  });
  it("names the action after an introductory location without losing the instruction", () => {
    const text = "In a skillet over medium-high heat, brown the ground turkey, breaking it up as it cooks, until no pink remains.";
    expect(cookingStepPresentation(text, "Directions")).toMatchObject({ heading: "Brown the ground turkey", instruction: text });
  });
  it("gives untitled instructions short, distinct headings instead of reusing the section", () => {
    const inputs = ["Add the diced onion and cook for 5 minutes.", "Cover and cook on low for 6–8 hours.", "Taste and season with salt if needed."];
    const titles = inputs.map((text) => cookingStepPresentation(text, "Directions").heading);
    expect(new Set(titles).size).toBe(3);
    expect(titles.every((title) => title.length > 0 && title.length <= 42 && title !== "Directions")).toBe(true);
    inputs.forEach((text) => expect(cookingStepPresentation(text, "Directions").instruction).toBe(text));
  });
});

describe("complete and advance", () => {
  const steps = ["0:0", "0:1", "1:0"];
  it("checks the current step and advances in one progress update", () => {
    const before = { currentStep: 0, checkedSteps: [], checkedIngredients: ["0:2"] };
    expect(completeCookingStep(before, steps)).toEqual({ currentStep: 1, checkedSteps: ["0:0"], checkedIngredients: ["0:2"] });
    expect(before.checkedSteps).toEqual([]);
  });
  it("stays on the final step and never duplicates a checkoff", () => {
    const progress = { currentStep: 2, checkedSteps: ["0:0", "0:1", "1:0"], checkedIngredients: [] };
    expect(completeCookingStep(progress, steps)).toEqual(progress);
  });
  it("leaves invalid or empty progress unchanged", () => {
    const progress = { currentStep: 4, checkedSteps: [], checkedIngredients: [] };
    expect(completeCookingStep(progress, steps)).toEqual(progress);
    expect(completeCookingStep(progress, [])).toEqual(progress);
  });
});
