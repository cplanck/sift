import { z } from "zod";
import { database } from "@/db";
import { extractRecipeHtml, parsePastedRecipe } from "@/domain/import";
import { extractRecipe } from "@/ai/extract-recipe";
import { fetchRecipeUrl, fetchRecipeImage } from "@/lib/safe-fetch";
import { readPhotoObject } from "@/lib/r2";
import { ConfigurationError } from "@/lib/env";
import { DomainError } from "@/domain/errors";
import { getPhoto, saveImportedRecipePhoto } from "@/services/photos";
import { importForJob, markImportFailed, markImportProcessing, saveExtractedImport } from "@/services/imports";
import { inngest } from "./client";

export const importRecipeJob = inngest.createFunction({
  id: "import-recipe", triggers: { event: "sift/import.requested" }, retries: 3,
  concurrency: { limit: 5 },
  onFailure: async ({ event }) => {
    const data = z.object({ importId: z.uuid() }).parse(event.data.event.data);
    await markImportFailed(database(), data.importId, "This import could not be completed. Check the source and provider configuration, then start a new import.");
  },
}, async ({ event, step }) => {
  const { importId } = z.object({ importId: z.uuid() }).parse(event.data);
  await step.run("mark-processing", () => markImportProcessing(database(), importId));
  // Source/recipe text stays in our database, not in Inngest event payloads or step results.
  return step.run("extract-and-save-draft", async () => {
    const db = database(), { record, actor } = await importForJob(db, importId);
    if (record.recipeId) return { recipeId: record.recipeId };
    try {
      const extractionContext = { db, actor, importId };
      let content, source, imageUrl: string | null = null;
      if (record.kind === "url") {
        const page = await fetchRecipeUrl(record.sourceUrl!);
        const extracted = extractRecipeHtml(page.html);
        if (extracted.imageUrl) { try { imageUrl = new URL(extracted.imageUrl, page.url).href; } catch { /* Optional image. */ } }
        content = extracted.content ?? await extractRecipe({ text: extracted.text }, extractionContext);
        source = { type: "url" as const, url: page.url, name: new URL(page.url).hostname, rawText: extracted.text, importedAt: new Date().toISOString() };
      } else if (record.kind === "image") {
        const photo = await getPhoto(db, actor, record.photoId!);
        content = await extractRecipe({ image: await readPhotoObject(photo.objectKey), mediaType: photo.contentType }, extractionContext);
        source = { type: "image" as const, name: "Recipe photo", importedAt: new Date().toISOString() };
      } else {
        content = parsePastedRecipe(record.rawText!) ?? await extractRecipe({ text: record.rawText! }, extractionContext);
        source = { type: "paste" as const, rawText: record.rawText!, importedAt: new Date().toISOString() };
      }
      const recipeId = await saveExtractedImport(db, actor, importId, content, source);
      if (imageUrl) {
        try { const image = await fetchRecipeImage(imageUrl); await saveImportedRecipePhoto(db, actor, recipeId, image.bytes); }
        catch { /* Missing or blocked source images never block the saved draft. */ }
      }
      return { recipeId };
    } catch (error) {
      if (error instanceof ConfigurationError || error instanceof DomainError) {
        await markImportFailed(db, importId, error.message);
        return { failed: true };
      }
      // Do not let provider exceptions (which may include request contents) reach job logs.
      throw new Error("Recipe extraction failed. Check provider availability and retry.");
    }
  });
});
