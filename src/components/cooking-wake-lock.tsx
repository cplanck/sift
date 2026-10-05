"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Sun } from "lucide-react";
import { Button } from "./ui/button";

export function CookingWakeLock() {
  const [enabled, setEnabled] = useState(false), [held, setHeld] = useState(false), [message, setMessage] = useState("");
  const wanted = useRef(false), lock = useRef<WakeLockSentinel | null>(null), requesting = useRef(false);
  const acquire = useCallback(async () => {
    if (!wanted.current || document.visibilityState !== "visible" || lock.current || requesting.current) return;
    if (!("wakeLock" in navigator)) { setMessage("This browser can’t keep the screen awake. Use your device’s display settings if needed."); return; }
    requesting.current = true;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      if (!wanted.current) { await sentinel.release(); return; }
      lock.current = sentinel; setHeld(true); setMessage("");
      sentinel.addEventListener("release", () => { if (lock.current === sentinel) { lock.current = null; setHeld(false); } });
    } catch { setMessage("Your device couldn’t keep the screen awake. Low power mode or browser settings may prevent it."); }
    finally { requesting.current = false; }
  }, []);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") void acquire(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { wanted.current = false; void lock.current?.release(); document.removeEventListener("visibilitychange", onVisible); };
  }, [acquire]);
  return <div className="space-y-2"><Button size="sm" variant="ghost" aria-pressed={enabled} onClick={() => {
    wanted.current = !enabled; setEnabled(!enabled); setMessage("");
    if (!enabled) void acquire(); else { void lock.current?.release(); lock.current = null; setHeld(false); }
  }}><Sun />{held ? "Screen stays awake" : enabled ? "Screen awake enabled" : "Keep screen awake"}</Button>
    {enabled && !held && !message && <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">Screen awake resumes when you return to this tab.</p>}
    {message && <p role="status" className="max-w-sm text-xs leading-relaxed text-muted-foreground">{message}</p>}
  </div>;
}
