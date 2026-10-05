"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main id="main" className="page-width py-24"><h1 className="text-3xl font-medium">We couldn’t open your cookbook.</h1><p className="my-6 text-muted-foreground">Please check your connection and try again.</p><Button onClick={reset}>Try again</Button></main>;
}
