import { auth } from "@/lib/auth";
import { apiError } from "@/lib/http";
export const runtime = "nodejs";
async function handler(request: Request) {
  try { return await auth().handler(request); } catch (error) { return apiError(error); }
}
export { handler as GET, handler as POST };
