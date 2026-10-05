"use client";
import { useId, useState } from "react";
import { usePathname } from "next/navigation";
import { AudioLines, LoaderCircle, Mic, RefreshCw, SlidersHorizontal, Square, X } from "lucide-react";
import { useMicrophonePreference, useMicrophoneTest } from "./use-microphone";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";

export function MicrophoneSettings({ voiceBusy = false, disabled = false }: { voiceBusy?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label="Microphone settings" title="Choose and test microphone"><SlidersHorizontal className="size-4" /></Button></DialogTrigger>
    {open && <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-sm"><div className="flex items-start justify-between gap-3"><DialogHeader className="text-left"><DialogTitle>Microphone</DialogTitle><DialogDescription>Choose an input for Sift and check its sound level.</DialogDescription></DialogHeader><DialogClose asChild><Button type="button" variant="ghost" size="icon" aria-label="Close"><X /></Button></DialogClose></div><MicrophoneSetup key={pathname} voiceBusy={voiceBusy} /></DialogContent>}
  </Dialog>;
}
function MicrophoneSetup({ voiceBusy }: { voiceBusy: boolean }) {
  const id = useId(), preference = useMicrophonePreference(), microphone = useMicrophoneTest();
  const busy = microphone.phase !== "idle", unavailable = !!preference.deviceId && !microphone.devices.some((device) => device.id === preference.deviceId);
  return <div className="space-y-5">
    <div className="space-y-2"><label htmlFor={id} className="text-sm font-medium">Audio input</label><select id={id} value={preference.deviceId} disabled={voiceBusy || busy} onChange={(event) => { microphone.stop(); preference.select(event.target.value); }} className="h-11 w-full min-w-0 rounded-xl border bg-background px-3 text-sm"><option value="">System default</option>{unavailable && <option value={preference.deviceId}>Saved microphone (not listed)</option>}{microphone.devices.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}</select><p className="text-xs leading-relaxed text-muted-foreground">{voiceBusy ? "End voice before changing or testing the microphone." : unavailable ? "Your saved input may be disconnected or need permission. Refresh access or choose another microphone." : "This choice is saved in this browser."}</p></div>
    {!voiceBusy && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void microphone.request(false, "")}><RefreshCw />{microphone.hasPermission ? "Refresh microphones" : "Allow microphone access"}</Button></div>}
    <div className="space-y-3 rounded-xl border bg-muted/20 p-4"><div className="flex items-center justify-between gap-3"><p className="flex items-center gap-2 text-sm font-medium"><AudioLines className="size-4" />Input level</p><p role="status" className="text-xs text-muted-foreground">{voiceBusy ? "Voice is active" : microphone.phase === "testing" ? "Speak to test" : microphone.phase === "permission" ? "Waiting for microphone…" : "Microphone off"}</p></div><div role="meter" aria-label="Microphone input level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={microphone.level} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground transition-[width] duration-100" style={{ width: `${microphone.level}%` }} /></div><Button type="button" variant="outline" size="sm" disabled={voiceBusy} onClick={() => busy ? microphone.stop() : void microphone.request(true, preference.deviceId)}>{busy ? microphone.phase === "permission" ? <LoaderCircle className="animate-spin" /> : <Square /> : <Mic />}{busy ? "Stop test" : "Test microphone"}</Button><p className="text-xs leading-relaxed text-muted-foreground">This test stays on your device and stops after 15 seconds. It doesn’t record or send audio and uses no voice credits.</p></div>
    {microphone.error && <p role="alert" className="text-sm leading-relaxed text-destructive">{microphone.error}</p>}
  </div>;
}
