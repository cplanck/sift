import { Brand } from "./brand";
import { AccountMenu } from "./account-menu";
export function AppHeader({ name }: { name: string }) {
  return <header className="page-width flex h-20 items-center justify-between border-b border-border/50"><Brand /><AccountMenu name={name} /></header>;
}
