import { z } from "zod";
import { database } from "@/db";
import { setShoppingListArchivedSchema, updateGroceryItemSchema, clearCheckedGroceryItemsSchema, restoreGroceryItemsSchema, addShoppingRecipeSchema, removeShoppingRecipeSchema, updateShoppingRecipeSchema, addGroceryItemsSchema, addMealEntrySchema, checkGroceryItemSchema, expectedRevisionSchema, removeGroceryItemSchema, removeMealEntrySchema } from "@/domain/artifact";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { setShoppingListArchived, updateGroceryItem, restoreGroceryItems, clearCheckedGroceryItems, addShoppingRecipe, removeShoppingRecipe, updateShoppingRecipe, addGroceryItems, addMealPlanEntry, combineGroceryList, removeGroceryItem, removeMealPlanEntry, setGroceryItemChecked } from "@/services/artifacts";

const actions = z.discriminatedUnion("action", [
  setShoppingListArchivedSchema.extend({ action: z.literal("archive") }).strict(),
  updateGroceryItemSchema.extend({ action: z.literal("updateItem") }).strict(),
  restoreGroceryItemsSchema.extend({ action: z.literal("restoreItems") }).strict(),
  clearCheckedGroceryItemsSchema.extend({ action: z.literal("clearChecked") }).strict(),
  addShoppingRecipeSchema.extend({ action: z.literal("addRecipe") }),
  removeShoppingRecipeSchema.extend({ action: z.literal("removeRecipe") }),
  updateShoppingRecipeSchema.extend({ action: z.literal("updateRecipe") }),
  addGroceryItemsSchema.extend({ action: z.literal("addItems") }).strict(),
  removeGroceryItemSchema.extend({ action: z.literal("removeItem") }).strict(),
  checkGroceryItemSchema.extend({ action: z.literal("checkItem") }).strict(),
  expectedRevisionSchema.extend({ action: z.literal("combine") }).strict(),
  addMealEntrySchema.extend({ action: z.literal("addEntry") }).strict(),
  removeMealEntrySchema.extend({ action: z.literal("removeEntry") }).strict(),
]);
const handlers = { archive: setShoppingListArchived, updateItem: updateGroceryItem, restoreItems: restoreGroceryItems, clearChecked: clearCheckedGroceryItems, addRecipe: addShoppingRecipe, removeRecipe: removeShoppingRecipe, updateRecipe: updateShoppingRecipe, addItems: addGroceryItems, removeItem: removeGroceryItem, checkItem: setGroceryItemChecked, combine: combineGroceryList, addEntry: addMealPlanEntry, removeEntry: removeMealPlanEntry };
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request), { id } = await params;
    const { action, ...input } = actions.parse(await readJson(request));
    return json(await handlers[action](database(), actor, id, input));
  } catch (error) { return apiError(error); }
}
