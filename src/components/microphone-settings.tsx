"use client";
import { useId, useState } from "react";
import { usePathname } from "next/navigation";
import { AudioLines, ChevronDown, LoaderCircle, Mic, RefreshCw, SlidersHorizontal, Square, Volume2, X } from "lucide-react";
import { useMicrophonePreference, useMicrophoneTest } from "./use-microphone";
import { useSpeakerPreference, useSpeakerTest } from "./use-speaker";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

export function MicrophoneSettings({ voiceBusy = false, disabled = false, onEndVoice }: { voiceBusy?: boolean; disabled?: boolean; onEndVoice?: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label="Microphone settings" title="Choose and test microphone"><SlidersHorizontal className="size-4" /></Button></DialogTrigger>
    {open && <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-sm"><div className="flex items-start justify-between gap-3"><DialogHeader className="text-left"><DialogTitle>Microphone &amp; speaker</DialogTitle><DialogDescription>Choose where Sift hears you and plays its replies.</DialogDescription></DialogHeader><DialogClose asChild><Button type="button" variant="ghost" size="icon" aria-label="Close"><X /></Button></DialogClose></div><MicrophoneSetup key={pathname} voiceBusy={voiceBusy} onEndVoice={onEndVoice} /></DialogContent>}
  </Dialog>;
}
function MicrophoneSetup({ voiceBusy, onEndVoice }: { voiceBusy: boolean; onEndVoice?: () => Promise<void> }) {
  const id = useId(), preference = useMicrophonePreference(), microphone = useMicrophoneTest();
  const output = useSpeakerPreference(), speaker = useSpeakerTest(output.select);
  const busy = microphone.phase !== "idle", unavailable = !!preference.deviceId && !microphone.devices.some((device) => device.id === preference.deviceId);
  const label = preference.deviceId ? microphone.devices.find((device) => device.id === preference.deviceId)?.label ?? "Saved microphone (not listed)" : "System default";
  const speakerBusy = speaker.phase !== "idle", missingSpeaker = !!output.deviceId && !speaker.devices.some((device) => device.id === output.deviceId);
  const speakerLabel = output.deviceId ? speaker.devices.find((device) => device.id === output.deviceId)?.label ?? "Saved speaker (not listed)" : "System default";
  return <div className="space-y-5">
    {voiceBusy && <div className="space-y-2"><p className="text-xs leading-relaxed text-muted-foreground">Changing a device ends the current voice call. Start voice again to use it.</p>{onEndVoice && <Button type="button" variant="outline" size="sm" onClick={() => void onEndVoice()}><Square />End voice to test audio</Button>}</div>}
    <div className="space-y-2">
      <p id={`${id}-label`} className="text-sm font-medium">Audio input</p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button type="button" variant="outline" aria-labelledby={`${id}-label ${id}-value`} className="h-auto min-h-11 w-full min-w-0 justify-between gap-3 px-3 py-2.5 text-left font-normal whitespace-normal"><span id={`${id}-value`} className="min-w-0 break-words">{label}</span><ChevronDown className="size-4 shrink-0" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" aria-label="Audio input devices" className="w-(--radix-dropdown-menu-trigger-width) max-w-[calc(100vw-4rem)]">
          <DropdownMenuRadioGroup value={preference.deviceId} onValueChange={(value) => { microphone.stop(); preference.select(value); }}>
            <DropdownMenuRadioItem value="" className="min-h-11 whitespace-normal">System default</DropdownMenuRadioItem>
            {unavailable && <DropdownMenuRadioItem value={preference.deviceId} disabled className="min-h-11 whitespace-normal">Saved microphone (not listed)</DropdownMenuRadioItem>}
            {microphone.devices.map((device) => <DropdownMenuRadioItem key={device.id} value={device.id} className="min-h-11 py-2.5 whitespace-normal"><span className="min-w-0 break-words">{device.label}</span></DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="text-xs leading-relaxed text-muted-foreground">{busy ? "Choosing another input stops the current test." : unavailable ? "Your saved input may be disconnected or need permission. Refresh access or choose another microphone." : "This choice is saved in this browser."}</p>
    </div>
    {!voiceBusy && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={async () => { await microphone.request(false, ""); await speaker.refresh(); }}><RefreshCw />{microphone.hasPermission ? "Refresh microphones" : "Allow microphone access"}</Button></div>}
    <div className="space-y-3 rounded-xl border bg-muted/20 p-4"><div className="flex items-center justify-between gap-3"><p className="flex items-center gap-2 text-sm font-medium"><AudioLines className="size-4" />Input level</p><p role="status" className="text-xs text-muted-foreground">{voiceBusy ? "Voice is active" : microphone.phase === "testing" ? "Speak to test" : microphone.phase === "permission" ? "Waiting for microphone…" : "Microphone off"}</p></div><div role="meter" aria-label="Microphone input level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={microphone.level} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground transition-[width] duration-100" style={{ width: `${microphone.level}%` }} /></div><Button type="button" variant="outline" size="sm" disabled={voiceBusy} onClick={() => { speaker.stop(); if (busy) microphone.stop(); else void microphone.request(true, preference.deviceId); }}>{busy ? microphone.phase === "permission" ? <LoaderCircle className="animate-spin" /> : <Square /> : <Mic />}{busy ? "Stop test" : "Test microphone"}</Button><p className="text-xs leading-relaxed text-muted-foreground">This test stays on your device and stops after 15 seconds. It doesn’t record or send audio and uses no voice credits.</p></div>
    {microphone.error && <p role="alert" className="text-sm leading-relaxed text-destructive">{microphone.error}</p>}
    <section aria-label="Speaker" className="space-y-3 border-t pt-5">
      <p id={`${id}-speaker-label`} className="text-sm font-medium">Speaker</p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button type="button" variant="outline" aria-labelledby={`${id}-speaker-label ${id}-speaker-value`} className="h-auto min-h-11 w-full min-w-0 justify-between gap-3 px-3 py-2.5 text-left font-normal whitespace-normal"><span id={`${id}-speaker-value`} className="min-w-0 break-words">{speakerLabel}</span><ChevronDown className="size-4 shrink-0" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" aria-label="Speaker devices" className="w-(--radix-dropdown-menu-trigger-width) max-w-[calc(100vw-4rem)]">
          <DropdownMenuRadioGroup value={output.deviceId} onValueChange={(value) => { speaker.stop(); output.select(value); }}>
            <DropdownMenuRadioItem value="" className="min-h-11 whitespace-normal">System default</DropdownMenuRadioItem>
            {missingSpeaker && <DropdownMenuRadioItem value={output.deviceId} disabled className="min-h-11 whitespace-normal">Saved speaker (not listed)</DropdownMenuRadioItem>}
            {speaker.canRoute && speaker.devices.map((device) => <DropdownMenuRadioItem key={device.id} value={device.id} className="min-h-11 py-2.5 whitespace-normal"><span className="min-w-0 break-words">{device.label}</span></DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="text-xs leading-relaxed text-muted-foreground">{!speaker.canRoute ? "This browser uses your system output. Choose System default here and select the speaker in your device’s sound settings." : missingSpeaker ? "Your saved speaker may need permission or be disconnected. Choose an available output before starting voice." : "Replies play through this output. Your microphone choice doesn’t change it."}</p>
      {!voiceBusy && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={speakerBusy} onClick={() => void speaker.refresh()}><RefreshCw />Refresh speakers</Button>{speaker.canChoose && speaker.canRoute && <Button type="button" variant="ghost" size="sm" disabled={speakerBusy} onClick={() => void speaker.choose()}>Choose in browser</Button>}</div>}
      <Button type="button" variant="outline" size="sm" disabled={voiceBusy} onClick={() => { microphone.stop(); if (speakerBusy) speaker.stop(); else void speaker.play(output.deviceId); }}>{speakerBusy ? <Square /> : <Volume2 />}{speakerBusy ? speaker.phase === "choosing" ? "Cancel speaker selection" : "Stop test sound" : "Play test sound"}</Button>
      <p aria-live="polite" className="text-xs leading-relaxed text-muted-foreground">{speaker.phase === "testing" ? "Playing a short tone through your selected speaker." : speaker.phase === "starting" ? "Starting the test sound…" : speaker.phase === "choosing" ? "Choose a speaker in the browser prompt." : "The short test sound stays on this device and uses no voice credits."}</p>
      {speaker.error && <p role="alert" className="text-sm leading-relaxed text-destructive">{speaker.error}</p>}
    </section>
  </div>;
}
