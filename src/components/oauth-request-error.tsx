import Link from "next/link";
import { Button } from "./ui/button";

export function OAuthRequestError() {
  return <div className="w-full max-w-md space-y-5">
    <p className="text-xs uppercase tracking-[.2em] text-muted-foreground">Connect to Sift</p>
    <h1 className="text-3xl font-medium tracking-tight">This connection request isn’t valid.</h1>
    <p className="text-sm leading-relaxed text-muted-foreground">It may have expired or changed. Return to the app you’re connecting and start again. No access has been granted.</p>
    <Button asChild variant="outline"><Link href="/library">Back to Sift</Link></Button>
  </div>;
}
