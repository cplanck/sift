import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, json } from "@/lib/http";
import { getUsageSummary } from "@/services/ai-usage";

export async function GET(request: Request) {
  try { return json(await getUsageSummary(database(), await requestActor(request))); }
  catch (error) { return apiError(error); }
}
