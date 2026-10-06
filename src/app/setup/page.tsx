import Link from "next/link";
import { Brand } from "@/components/brand";

export default function Setup() {
  return <div className="page-width max-w-2xl py-5 sm:py-10"><Brand /><main id="main" className="py-8 sm:py-16">
    <p className="text-sm text-muted-foreground">Sift setup</p><h1 className="mt-3 text-3xl sm:text-4xl font-medium tracking-tight">Make room for your cookbook.</h1>
    <p className="mt-6 leading-relaxed text-muted-foreground">This installation needs its database and authentication configured. Follow the setup instructions in <code>IMPLEMENTATION.md</code>, then restart Sift.</p>
    <Link href="/" className="mt-8 inline-block underline underline-offset-4">Back to Sift</Link>
  </main></div>;
}
