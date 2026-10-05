import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { AuthForm } from "@/components/auth-form";
import { ThemeToggle } from "@/components/providers";
import { getViewer, isAuthConfigured } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function SignIn() {
  if (!isAuthConfigured()) redirect("/setup");
  if (await getViewer()) redirect("/library");
  return <div className="page-width"><header className="flex h-24 items-center justify-between"><Brand /><ThemeToggle /></header><main id="main" className="flex min-h-[75dvh] justify-center py-16"><AuthForm /></main></div>;
}
