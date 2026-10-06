import { z } from "zod";

export const createCookingTimerSchema = z.object({
  id: z.uuid().optional(),
  label: z.string().trim().min(1).max(80),
  durationSeconds: z.number().int().min(1).max(86400),
  stepKey: z.string().regex(/^\d{1,2}:\d{1,3}$/).nullable().optional(),
}).strict();
export const updateCookingTimerSchema = z.object({
  expectedRevision: z.number().int().positive(),
  action: z.enum(["pause", "resume", "extend", "restart", "dismiss"]),
  seconds: z.number().int().min(1).max(86400).optional(),
}).strict().refine((value) => value.action !== "extend" || value.seconds !== undefined, "Specify how many seconds to add.");

export type CookingTimerRecord = {
  id: string; sessionId: string; label: string; stepKey: string | null;
  durationSeconds: number; remainingMs: number; dueAt: string | null;
  status: "running" | "paused" | "dismissed"; revision: number;
};
export type TimerUpdate = z.infer<typeof updateCookingTimerSchema>;
export type CookingTimerList = { timers: CookingTimerRecord[]; serverNow: string };

export function timerRemainingMs(timer: CookingTimerRecord, now: number) {
  return timer.status === "running" && timer.dueAt ? Math.max(0, Date.parse(timer.dueAt) - now) : timer.remainingMs;
}
export function timerPhase(timer: CookingTimerRecord, now: number) {
  return timer.status === "running" && timerRemainingMs(timer, now) === 0 ? "elapsed" : timer.status;
}
export function changeTimer(timer: CookingTimerRecord, update: TimerUpdate, now: number): CookingTimerRecord {
  const remaining = timerRemainingMs(timer, now);
  const next = { ...timer, revision: timer.revision + 1 };
  switch (update.action) {
    case "pause": return { ...next, status: "paused", remainingMs: remaining, dueAt: null };
    case "resume": return { ...next, status: "running", dueAt: new Date(now + remaining).toISOString() };
    case "restart": return { ...next, status: "running", remainingMs: timer.durationSeconds * 1000, dueAt: new Date(now + timer.durationSeconds * 1000).toISOString() };
    case "dismiss": return { ...next, status: "dismissed", remainingMs: 0, dueAt: null };
    case "extend": {
      const remainingMs = Math.min(86400000, remaining + (update.seconds ?? 0) * 1000);
      return { ...next, remainingMs, dueAt: timer.status === "running" ? new Date(now + remainingMs).toISOString() : null };
    }
  }
}

export function formatTimer(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? `${hours}:${String(minutes).padStart(2, "0")}` : minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
