import { auth } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const paths = new Set([
  "/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/api/auth",
  "/.well-known/openid-configuration", "/.well-known/openid-configuration/api/auth",
  "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp",
]);
function metadata(request: Request) {
  if (!paths.has(new URL(request.url).pathname)) return new Response(null, { status: 404 });
  return auth().handler(request);
}
export { metadata as GET, metadata as HEAD };
