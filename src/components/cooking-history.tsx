import Link from "next/link";
import { ArrowUpRight, CookingPot } from "lucide-react";
import type { CookingHistoryItem } from "@/domain/cooking";

export function CookingHistory({ history }: { history: CookingHistoryItem[] }) {
  return <section className="mb-10 border-b pb-10"><h2 className="text-xl font-medium">Times you’ve made it.</h2><p className="mb-6 mt-2 text-sm text-muted-foreground">Each cook keeps its recipe version, observations, and photos.</p>
    {history.length ? <div className="space-y-3">{history.map((cook) => <Link key={cook.id} href={`/recipes/${cook.recipeId}?cook=${cook.id}`} className="flex items-start justify-between gap-4 rounded-2xl border p-5 hover:bg-muted/30"><div><h3 className="flex items-center gap-2 text-sm font-medium"><CookingPot size={16} />{cook.status === "active" ? "In progress" : cook.status === "completed" ? "Completed cook" : "Ended early"}</h3><p className="mt-2 text-sm text-muted-foreground">{new Date(cook.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} · Version {cook.versionNumber} · {cook.servings} servings{cook.rating != null ? ` · ${cook.rating}/5` : ""}</p>{cook.summary && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{cook.summary}</p>}</div><ArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground" /></Link>)}</div> : <p className="text-sm text-muted-foreground">No cooks yet. Choose Cook when you’re ready to make this recipe.</p>}
  </section>;
}
