import { z } from "zod";

const title = z.string().trim().min(1).max(160);
const itemText = z.string().trim().min(1).max(1000);
const groupName = z.string().trim().max(100);
const servings = z.number().positive().max(1000);
const revision = z.number().int().positive();
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Choose a valid calendar date.");
export const mealEntryInputSchema = z.object({
  date: calendarDate.nullable().optional(), meal: z.string().trim().min(1).max(60), title: title.optional(),
  recipeId: z.uuid().optional(), versionId: z.uuid().optional(), servings: servings.optional(), note: z.string().trim().max(2000).optional(),
}).strict().refine((data) => (!!data.recipeId === !!data.versionId) && (!!data.recipeId || !!data.title), "Choose a recipe and its version, or describe this meal.");
const groupInput = z.object({ name: groupName.default(""), items: z.array(z.object({ text: itemText }).strict()).max(200) }).strict();
export const createArtifactSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("grocery"), title, groups: z.array(groupInput).max(50).default([]) }).strict(),
  z.object({ kind: z.literal("meal-plan"), title, entries: z.array(mealEntryInputSchema).max(200).default([]) }).strict(),
]);
export const deriveGrocerySchema = z.object({ title, recipes: z.array(z.object({ recipeId: z.uuid(), versionId: z.uuid(), servings: servings.optional() }).strict()).min(1).max(30) }).strict();
// Existing derived group names may include both full recipe and section titles.
export const addGroceryItemsSchema = z.object({ expectedRevision: revision, groupName: z.string().trim().max(320).default(""), items: z.array(z.object({ text: itemText }).strict()).min(1).max(200) }).strict();
export const removeGroceryItemSchema = z.object({ expectedRevision: revision, itemId: z.uuid() }).strict();
export const checkGroceryItemSchema = removeGroceryItemSchema.extend({ checked: z.boolean() });
export const addMealEntrySchema = z.object({ expectedRevision: revision, entry: mealEntryInputSchema }).strict();
export const removeMealEntrySchema = z.object({ expectedRevision: revision, entryId: z.uuid() }).strict();
export const renameArtifactSchema = z.object({ expectedRevision: revision, title }).strict();
export const expectedRevisionSchema = z.object({ expectedRevision: revision }).strict();
export const updateGroceryItemSchema = z.object({ expectedRevision: revision, itemId: z.uuid(), text: itemText }).strict();
export const updateMealEntrySchema = z.object({
  expectedRevision: revision, entryId: z.uuid(),
  // Only supplied fields change; null clears a date (unscheduled).
  date: calendarDate.nullable().optional(), meal: z.string().trim().min(1).max(60).optional(), title: title.optional(),
  servings: servings.optional(), note: z.string().trim().max(2000).optional(),
}).strict();
const sourceSchema = z.object({ recipeId: z.uuid(), versionId: z.uuid(), servings });
export const groceryContentSchema = z.object({
  // Derived names combine recipe/section titles; scaled amounts may add digits
  // to original ingredient text. Preserve them without widening user inputs.
  kind: z.literal("grocery"), groups: z.array(z.object({ id: z.uuid(), name: z.string().trim().max(320), items: z.array(z.object({ id: z.uuid(), text: z.string().trim().min(1).max(1100), checked: z.boolean(), source: sourceSchema.optional() })).max(1000) })).max(100),
}).refine((data) => data.groups.reduce((total, group) => total + group.items.length, 0) <= 1000, "A grocery list can hold up to 1,000 items.");
export const mealPlanContentSchema = z.object({
  kind: z.literal("meal-plan"), entries: z.array(z.object({
    id: z.uuid(), date: calendarDate.nullable(), meal: z.string().trim().min(1).max(60), title,
    recipeId: z.uuid().nullable(), recipeVersionId: z.uuid().nullable(), servings: servings.nullable(), note: z.string().max(2000),
  })).max(200),
});
export const artifactContentSchema = z.discriminatedUnion("kind", [groceryContentSchema, mealPlanContentSchema]);
export type ArtifactContent = z.infer<typeof artifactContentSchema>;
export type MealEntryInput = z.infer<typeof mealEntryInputSchema>;
export type ArtifactKind = ArtifactContent["kind"];
export type ArtifactSummary = { id: string; kind: ArtifactKind; title: string; revision: number; updatedAt: string };
export type ArtifactDetail = ArtifactSummary & { content: ArtifactContent; createdAt: string };

export function artifactToText(artifact: Pick<ArtifactDetail, "title" | "content">) {
  const lines = [artifact.title, ""];
  if (artifact.content.kind === "grocery") {
    for (const group of artifact.content.groups) {
      if (group.name) lines.push(group.name);
      for (const item of group.items) lines.push(`${item.checked ? "[x]" : "[ ]"} ${item.text}`);
      lines.push("");
    }
  } else {
    for (const entry of artifact.content.entries) {
      lines.push(`${entry.date ? `${entry.date} · ` : ""}${entry.meal}: ${entry.title}${entry.servings ? ` (${entry.servings} servings)` : ""}`);
      if (entry.note) lines.push(entry.note);
    }
  }
  return lines.join("\n").trim();
}
