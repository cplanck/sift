import Link from "next/link";
export default function NotFound() {
  return <main id="main" className="page-width py-24"><h1 className="text-3xl font-medium">Nothing here just yet.</h1><p className="my-6 text-muted-foreground">This page may have moved, or you may not have access to it.</p><Link className="underline underline-offset-4" href="/">Back to your cookbook</Link></main>;
}
