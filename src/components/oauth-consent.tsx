"use client";
import { useState } from "react";
import { ArrowRight, BookOpen, LoaderCircle, PencilLine, Unplug } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { isOAuthCallback } from "@/lib/oauth-navigation";
import type { getVerifiedOAuthRequest } from "@/mcp/oauth-request";
import { connectionPermissions } from "./connected-apps";
import { Button } from "./ui/button";

type Request = Awaited<ReturnType<typeof getVerifiedOAuthRequest>>;
export function OAuthConsent({ request, email }: { request: Request; email: string }) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null), [error, setError] = useState("");
  async function respond(accept: boolean) {
    setBusy(accept ? "approve" : "deny"); setError("");
    try {
      const result = await authClient.oauth2.consent({ accept, scope: request.scopes.join(" "), oauth_query: request.oauthQuery });
      if (result.error) throw new Error(result.error.message ?? "Couldn’t complete this connection. Try again.");
      const response = result.data as { redirect_uri?: string; redirect?: boolean; url?: string };
      // The official client follows redirect/url responses, including a renewed
      // sign-in challenge. Older provider response shapes expose redirect_uri.
      if (response.redirect && response.url) return;
      const destination = response.redirect_uri;
      if (!destination || !isOAuthCallback(destination, request.redirectUri)) throw new Error("The app’s callback wasn’t available. Return to the app and try connecting again.");
      window.location.assign(destination);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Couldn’t complete this connection. Try again.");
      setBusy(null);
    }
  }
  return <div className="w-full max-w-lg space-y-7">
    <div><p className="text-xs uppercase tracking-[.2em] text-muted-foreground">Connect to Sift</p><h1 className="mt-4 text-3xl font-medium tracking-tight">Give this app access?</h1><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Review what it can do in your personal cookbook.</p></div>
    <section aria-label="Requesting app" className="space-y-2 rounded-2xl border bg-muted/20 p-5"><h2 className="break-words text-lg font-medium">{request.clientName}</h2><p className="break-all text-xs leading-relaxed text-muted-foreground">{request.clientId}</p><p className="break-all text-xs leading-relaxed text-muted-foreground">Returns to {new URL(request.redirectUri).origin}</p></section>
    <ul aria-label="Requested permissions" className="space-y-5">{request.scopes.map((scope) => {
      const permission = connectionPermissions[scope];
      const Icon = scope === "recipes:read" ? BookOpen : scope === "recipes:write" ? PencilLine : Unplug;
      return <li key={scope} className="flex gap-3"><Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" /><div><h3 className="text-sm font-medium">{permission?.title ?? scope}</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{permission?.description}</p></div></li>;
    })}</ul>
    <div className="space-y-3 border-t pt-5"><p className="break-words text-xs leading-relaxed text-muted-foreground">Signed in as <span className="text-foreground">{email}</span>. Only approve apps you trust. You can revoke access in Sift settings.</p>{error && <p role="alert" className="text-sm leading-relaxed text-destructive">{error}</p>}<div className="flex flex-wrap gap-3"><Button className="flex-1" disabled={!!busy} onClick={() => void respond(true)}>{busy === "approve" ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}Allow access</Button><Button variant="outline" className="flex-1" disabled={!!busy} onClick={() => void respond(false)}>{busy === "deny" && <LoaderCircle className="animate-spin" />}Deny</Button></div></div>
  </div>;
}
