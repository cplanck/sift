import { z } from "zod";
import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { addRecipeNote, getRecipe, restoreVersion, setFavorite, setRecipeStatus, updateRecipe } from "@/services/recipes";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("favorite"), favorite: z.boolean() }),
  z.object({ action: z.literal("note"), body: z.string().trim().min(1).max(5000) }),
  z.object({ action: z.literal("restore"), versionId: z.uuid(), expectedVersionId: z.uuid() }),
  z.object({ action: z.literal("status"), status: z.enum(["active", "archived"]) }),
  z.object({ action: z.literal("rename"), title: z.string().trim().min(1).max(160), expectedVersionId: z.uuid() }),
]);
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request), { id } = await params, data = actionSchema.parse(await readJson(request)), db = database();
    switch (data.action) {
      case "favorite": return json(await setFavorite(db, actor, id, data.favorite));
      case "note": return json(await addRecipeNote(db, actor, id, data), 201);
      case "restore": return json(await restoreVersion(db, actor, id, data));
      case "status": return json(await setRecipeStatus(db, actor, id, data.status));
      case "rename": {
        const recipe = await getRecipe(db, actor, id);
        return json(await updateRecipe(db, actor, id, { content: { ...recipe.version.content, title: data.title }, expectedVersionId: data.expectedVersionId, changeSummary: "Renamed recipe" }));
      }
    }
  } catch (error) { return apiError(error); }
}
