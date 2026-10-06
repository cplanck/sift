"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AuthForm({ oauthClientName, initialMode = "sign-in" }: { oauthClientName?: string; initialMode?: "sign-in" | "sign-up" }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">(initialMode);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return <div className="w-full max-w-sm">
    <h1 className="text-4xl font-medium tracking-tight">{mode === "sign-in" ? "Welcome back." : "Make yourself at home."}</h1>
    {oauthClientName && <p className="mt-5 break-words text-sm leading-relaxed text-muted-foreground">Sign in to connect <span className="font-medium text-foreground">{oauthClientName}</span> to your cookbook. You’ll review its permissions before access is granted.</p>}
    <form className="mt-10 space-y-5" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError("");
      const data = new FormData(event.currentTarget);
      try {
        const credentials = { email: String(data.get("email")), password: String(data.get("password")) };
        const result = mode === "sign-up" ? await authClient.signUp.email({ ...credentials, name: String(data.get("name")) }) : await authClient.signIn.email(credentials);
        if (result.error) setError(result.error.message ?? "Please check your details and try again.");
        // The OAuth provider resumes its signed authorization request after
        // sign-in/sign-up. Navigating to Library here would race that redirect.
        else if (!oauthClientName) { router.push("/library"); router.refresh(); }
        else {
          const continuation = result.data as unknown as { redirect?: boolean; url?: string };
          if (!continuation?.redirect || !continuation.url) setError("You’re signed in, but this connection wasn’t completed. Return to the app and try connecting again.");
        }
      } catch { setError("We couldn’t connect. Please try again."); }
      finally { setBusy(false); }
    }}>
      {mode === "sign-up" && <label className="block text-sm">Your name<Input className="mt-2" name="name" autoComplete="name" required maxLength={100} /></label>}
      <label className="block text-sm">Email<Input className="mt-2" name="email" type="email" autoComplete="email" required maxLength={254} /></label>
      <label className="block text-sm">Password<Input className="mt-2" name="password" type="password" autoComplete={mode === "sign-up" ? "new-password" : "current-password"} required minLength={12} maxLength={128} /></label>
      {mode === "sign-up" && <p className="text-xs text-muted-foreground">Use at least 12 characters.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}{mode === "sign-in" ? "Sign in" : "Create cookbook"}</Button>
    </form>
    <Button variant="ghost" className="mt-6 w-full whitespace-normal" disabled={busy} onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setError(""); }}>
      {mode === "sign-in" ? "New here? Create an account" : "Already have an account? Sign in"}
    </Button>
  </div>;
}
