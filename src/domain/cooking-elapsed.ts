/** Derive duration from timestamps so suspended tabs never lose elapsed time. */
export function cookingElapsedTime(startedAt: string, finishedAt: string | null, now: number) {
  const duration = (finishedAt ? Date.parse(finishedAt) : now) - Date.parse(startedAt);
  const seconds = Number.isFinite(duration) ? Math.max(0, Math.floor(duration / 1000)) : 0;
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((part) => String(part).padStart(2, "0")).join(":");
}
