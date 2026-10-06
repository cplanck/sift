import { describe, expect, it } from "vitest";
import { combineGroceryItems, groceryToMarkdown } from "@/domain/grocery";

let next = 0;
const id = () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
const list = (...groups: [string, string[]][]) => ({ kind: "grocery" as const, groups: groups.map(([name, items]) => ({ id: id(), name, items: items.map((text) => ({ id: id(), text, checked: false })) })) });

describe("combineGroceryItems", () => {
  it("adds matching ingredients that share a unit", () => {
    const combined = combineGroceryItems(list(["Chili", ["2 onions, diced", "1 tbsp olive oil", "1 cup broth"]], ["Soup", ["1 onion", "2 tablespoons olive oil", "salt"]], ["Salad", ["Salt"]]), id);
    expect(combined.groups).toHaveLength(1);
    expect(combined.groups[0].items.map((item) => item.text)).toEqual(["3 onions, diced", "3 tablespoons olive oil", "1 cup broth", "salt"]);
  });
  it("keeps different units, ranges and package sizes apart", () => {
    const combined = combineGroceryItems(list(["A", ["1 cup flour", "200 g flour", "2–3 cloves garlic", "garlic", "1 14-oz can beans", "1 can beans"]]), id);
    expect(combined.groups[0].items.map((item) => item.text)).toEqual(["1 cup flour", "200 g flour", "2–3 cloves garlic", "garlic", "1 14-oz can beans", "1 can beans"]);
  });
  it("only stays checked when every merged line was checked", () => {
    const content = list(["A", ["1 lemon", "2 lemons", "1 lime", "1 lime"]]);
    content.groups[0].items[0].checked = true; content.groups[0].items[2].checked = true; content.groups[0].items[3].checked = true;
    expect(combineGroceryItems(content, id).groups[0].items.map(({ text, checked }) => [text, checked])).toEqual([["3 lemons", false], ["2 lime", true]]);
  });
});

describe("groceryToMarkdown", () => {
  it("writes a checklist of what is still needed", () => {
    const content = list(["Chili", ["1 onion", "beans"]], ["Pantry", ["salt"]]);
    content.groups[1].items[0].checked = true;
    expect(groceryToMarkdown({ title: "Shopping list", content })).toBe("# Shopping list\n\n## Chili\n\n- [ ] 1 onion\n- [ ] beans\n");
    expect(groceryToMarkdown({ title: "Shopping list", content }, { includeChecked: true })).toContain("## Pantry\n\n- [x] salt");
  });
});
