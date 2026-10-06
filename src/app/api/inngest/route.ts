import { serve } from "inngest/next";
import { inngest } from "@/jobs/client";
import { importRecipeJob } from "@/jobs/import-recipe";
import { generateCoverJob, dispatchCoversJob } from "@/jobs/generate-cover";
import { organizeCookingNotesJob, dispatchCookingNotesJob } from "@/jobs/organize-cooking-notes";
export const runtime = "nodejs";
export const maxDuration = 120;
export const { GET, POST, PUT } = serve({ client: inngest, functions: [importRecipeJob, generateCoverJob, dispatchCoversJob, organizeCookingNotesJob, dispatchCookingNotesJob] });
