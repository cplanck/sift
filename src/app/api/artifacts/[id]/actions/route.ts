import { z } from "zod";
import { database } from "@/db";
import { addGroceryItemsSchema, addMealEntrySchema, checkGroceryItemSchema, removeGroceryItemSchema, removeMealEntrySchema } from "@/domain/artifact";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { addGroceryItems, addMealPlanEntry, removeGroceryItem, removeMealPlanEntry, setGroceryItemChecked } from "@/services/artifacts";

const actions = z.discriminatedUnion("action", [
  addGroceryItemsSchema.extend({ action: z.literal("addItems") }).strict(),
  removeGroceryItemSchema.extend({ action: z.literal("removeItem") }).strict(),
  checkGroceryItemSchema.extend({ action: z.literal("checkItem") }).strict(),
  addMealEntrySchema.extend({ action: z.literal("addEntry") }).strict(),
  removeMealEntrySchema.extend({ action: z.literal("removeEntry") }).strict(),
]);
const handlers = { addItems: addGroceryItems, removeItem: removeGroceryItem, checkItem: setGroceryItemChecked, addEntry: addMealPlanEntry, removeEntry: removeMealPlanEntry };
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request), { id } = await params;
    const { action, ...input } = actions.parse(await readJson(request));
    return json(await handlers[action](database(), actor, id, input));
  } catch (error) { return apiError(error); }
}
