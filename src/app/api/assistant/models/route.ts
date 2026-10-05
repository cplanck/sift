import { getAssistantModels } from "@/ai/models";
import { requestActor } from "@/lib/auth";
import { apiError, json } from "@/lib/http";

export async function GET(request: Request) {
  try {
    await requestActor(request);
    return json(getAssistantModels());
  } catch (error) { return apiError(error); }
}
