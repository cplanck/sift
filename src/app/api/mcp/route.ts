import { database } from "@/db";
import { apiError } from "@/lib/http";
import { withMcpAuth } from "@/mcp/auth";
import { handleAuthenticatedMcpRequest } from "@/mcp/server";

export const runtime = "nodejs";
export const maxDuration = 60;

async function handle(request: Request) {
  let response: Response;
  try { response = await withMcpAuth(request, (verifiedRequest, principal) => handleAuthenticatedMcpRequest(verifiedRequest, database(), principal)); }
  catch (error) { response = apiError(error); }
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export { handle as GET, handle as POST, handle as DELETE };
