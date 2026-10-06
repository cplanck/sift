import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { AuthForm } from "@/components/auth-form";
import { ThemeToggle } from "@/components/providers";
import { getViewer, isAuthConfigured } from "@/lib/auth";
import { oauthSearchQuery } from "@/lib/oauth-navigation";
import { getVerifiedOAuthRequest } from "@/mcp/oauth-request";
import { OAuthRequestError } from "@/components/oauth-request-error";
import { DomainError } from "@/domain/errors";
export const dynamic = "force-dynamic";
export default async function SignIn({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isAuthConfigured()) redirect("/setup");
  const params = await searchParams;
  const hasOAuthRequest = ["client_id", "sig", "ba_param", "oauth_query"].some((key) => key in params);
  let request: Awaited<ReturnType<typeof getVerifiedOAuthRequest>> | undefined;
  if (hasOAuthRequest) {
    try { request = await getVerifiedOAuthRequest(oauthSearchQuery(params)); }
    catch (error) { if (!(error instanceof DomainError)) throw error; }
  } else if (await getViewer()) redirect("/library");
  return <div className="page-width"><header className="flex h-24 items-center justify-between"><Brand /><ThemeToggle /></header><main id="main" className="flex min-h-[75dvh] justify-center py-16">{hasOAuthRequest && !request ? <OAuthRequestError /> : <AuthForm oauthClientName={request?.clientName} initialMode={!hasOAuthRequest && params.mode === "sign-up" ? "sign-up" : "sign-in"} />}</main></div>;
}
