import { Brand } from "./brand";
import { AccountMenu } from "./account-menu";
export function AppHeader({ name }: { name: string }) {
  return <header className="page-width flex h-24 items-center justify-between border-b"><Brand /><AccountMenu name={name} /></header>;
}
