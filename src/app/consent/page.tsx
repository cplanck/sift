import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/providers";
import { OAuthConsent } from "@/components/oauth-consent";
import { OAuthRequestError } from "@/components/oauth-request-error";
import { getViewer, isAuthConfigured } from "@/lib/auth";
import { oauthSearchQuery } from "@/lib/oauth-navigation";
import { getVerifiedOAuthRequest } from "@/mcp/oauth-request";
import { DomainError } from "@/domain/errors";

export const dynamic = "force-dynamic";
export default async function Consent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isAuthConfigured()) redirect("/setup");
  let request: Awaited<ReturnType<typeof getVerifiedOAuthRequest>> | undefined;
  try { request = await getVerifiedOAuthRequest(oauthSearchQuery(await searchParams)); }
  catch (error) { if (!(error instanceof DomainError)) throw error; }
  const viewer = request ? await getViewer() : null;
  if (request && !viewer) redirect(`/sign-in?${request.oauthQuery}`);
  return <div className="page-width"><header className="flex h-16 sm:h-24 items-center justify-between"><Brand /><ThemeToggle /></header><main id="main" className="flex min-h-[75dvh] justify-center py-10 sm:py-16">{request && viewer ? <OAuthConsent request={request} email={viewer.email} /> : <OAuthRequestError />}</main></div>;
}
