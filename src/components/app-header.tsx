import { Brand } from "./brand";
import { AccountMenu } from "./account-menu";
import { KitchenNavigation, type KitchenMode } from "./kitchen-navigation";

export const pageFrame = "w-full px-5 sm:px-8 lg:px-12";
export function AppHeader({ name, allowProductionSync, children, mode = "home", cookHref, compact = false }: { name: string; allowProductionSync?: boolean; children?: React.ReactNode; mode?: KitchenMode; cookHref?: string; compact?: boolean }) {
  return <header className={`${pageFrame} ${compact ? "sift-cook-header" : ""} relative z-10 grid min-h-16 sm:min-h-24 grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-2 sm:grid-cols-[1fr_auto_1fr] sm:py-5`}>
    <div className="flex items-center gap-5"><Brand href="/library" /><span className="hidden text-xs text-muted-foreground xl:block">agentic cooking</span></div>
    <div className="hidden sm:col-start-2 sm:row-start-1 sm:block"><KitchenNavigation active={mode} cookHref={cookHref} /></div>
    <div className="col-start-2 row-start-1 flex items-center justify-end gap-2 sm:col-start-3">{children}<AccountMenu name={name} allowProductionSync={allowProductionSync} /></div>
  </header>;
}
export function AppHeaderSkeleton() {
  return <header className={`${pageFrame} grid min-h-16 sm:min-h-24 grid-cols-[1fr_auto] items-center gap-y-1 py-2 sm:grid-cols-[1fr_auto_1fr] sm:py-5`}><Brand href="/library" /><div className="hidden sm:col-start-2 sm:row-start-1 sm:block"><KitchenNavigation /></div><span aria-hidden="true" className="col-start-2 row-start-1 flex size-11 items-center justify-center justify-self-end sm:col-start-3"><span className="size-8 rounded-full bg-muted motion-safe:animate-pulse" /></span></header>;
}
