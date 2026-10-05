import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, json } from "@/lib/http";
import { listMcpConnections } from "@/services/mcp-connections";

export async function GET(request: Request) {
  try { return json(await listMcpConnections(database(), await requestActor(request))); }
  catch (error) { return apiError(error); }
}
