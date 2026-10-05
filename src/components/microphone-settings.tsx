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
    {open && <DialogContent showCloseButton={false} className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[45rem] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[45rem]">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-5 py-5 sm:px-8 sm:py-6">
        <DialogHeader className="gap-2 text-left"><DialogTitle className="text-xl tracking-tight">Microphone &amp; speaker</DialogTitle><DialogDescription className="leading-relaxed">Choose your devices, then check your sound.</DialogDescription></DialogHeader>
        <DialogClose asChild><Button type="button" variant="ghost" size="icon" className="-mr-2 -mt-1 size-11 shrink-0 rounded-full text-muted-foreground" aria-label="Close"><X /></Button></DialogClose>
      </div>
      <MicrophoneSetup key={pathname} voiceBusy={voiceBusy} onEndVoice={onEndVoice} />
    </DialogContent>}
  </Dialog>;
}
function MicrophoneSetup({ voiceBusy, onEndVoice }: { voiceBusy: boolean; onEndVoice?: () => Promise<void> }) {
  const id = useId(), preference = useMicrophonePreference(), microphone = useMicrophoneTest();
  const output = useSpeakerPreference(), speaker = useSpeakerTest(output.select);
  const busy = microphone.phase !== "idle", unavailable = !!preference.deviceId && !microphone.devices.some((device) => device.id === preference.deviceId);
  const label = preference.deviceId ? microphone.devices.find((device) => device.id === preference.deviceId)?.label ?? "Saved microphone (not listed)" : "System default";
  const speakerBusy = speaker.phase !== "idle", missingSpeaker = !!output.deviceId && !speaker.devices.some((device) => device.id === output.deviceId);
  const speakerLabel = output.deviceId ? speaker.devices.find((device) => device.id === output.deviceId)?.label ?? "Saved speaker (not listed)" : "System default";
  return <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-6 sm:px-8 sm:py-7">
    {voiceBusy && <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/40 p-4"><p className="max-w-sm text-sm leading-relaxed text-muted-foreground">Changing a device ends this call. Start voice again to use it.</p>{onEndVoice && <Button type="button" variant="outline" size="sm" className="min-h-11 shrink-0 bg-background" onClick={() => void onEndVoice()}><Square />End voice to test audio</Button>}</div>}
    <div className="grid gap-8 sm:grid-cols-2 sm:gap-7">
    <section aria-label="Microphone" className="min-w-0 space-y-4">
      <h2 id={`${id}-label`} className="flex items-center gap-2.5 text-sm font-semibold"><Mic className="size-4 text-muted-foreground" />Audio input</h2>
      <div className="space-y-2.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button type="button" variant="outline" aria-labelledby={`${id}-label ${id}-value`} className="h-auto min-h-12 w-full min-w-0 justify-between gap-3 rounded-xl bg-muted/15 px-3.5 py-3 text-left font-normal whitespace-normal"><span id={`${id}-value`} className="min-w-0 break-words">{label}</span><ChevronDown className="size-4 shrink-0 text-muted-foreground" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" aria-label="Audio input devices" className="w-(--radix-dropdown-menu-trigger-width) max-w-[calc(100vw-4rem)]">
          <DropdownMenuRadioGroup value={preference.deviceId} onValueChange={(value) => { microphone.stop(); preference.select(value); }}>
            <DropdownMenuRadioItem value="" className="min-h-11 whitespace-normal">System default</DropdownMenuRadioItem>
            {unavailable && <DropdownMenuRadioItem value={preference.deviceId} disabled className="min-h-11 whitespace-normal">Saved microphone (not listed)</DropdownMenuRadioItem>}
            {microphone.devices.map((device) => <DropdownMenuRadioItem key={device.id} value={device.id} className="min-h-11 py-2.5 whitespace-normal"><span className="min-w-0 break-words">{device.label}</span></DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="text-xs leading-relaxed text-muted-foreground">{busy ? "Choosing another input stops the test." : unavailable ? "Your saved input may be disconnected or need permission." : "The microphone Sift listens to."}</p>
      </div>
      {!voiceBusy && <div className="flex min-h-11 flex-wrap items-center gap-2"><Button type="button" variant="ghost" size="sm" className="-ml-2 min-h-11 px-2 text-muted-foreground" disabled={busy} onClick={async () => { await microphone.request(false, ""); await speaker.refresh(); }}><RefreshCw />{microphone.hasPermission ? "Refresh microphones" : "Allow microphone access"}</Button></div>}
      <div className="space-y-4 rounded-xl bg-muted/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 text-sm font-medium"><AudioLines className="size-4 text-muted-foreground" />Input level</p><p role="status" className="text-xs text-muted-foreground">{voiceBusy ? "Voice is active" : microphone.phase === "testing" ? "Speak to test" : microphone.phase === "permission" ? "Waiting for microphone…" : "Microphone off"}</p></div>
        <div role="meter" aria-label="Microphone input level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={microphone.level} className="h-2 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-foreground transition-[width] duration-100 motion-reduce:transition-none" style={{ width: `${microphone.level}%` }} /></div>
        <Button type="button" variant="outline" size="sm" className="min-h-11 w-full bg-background" disabled={voiceBusy} onClick={() => { speaker.stop(); if (busy) microphone.stop(); else void microphone.request(true, preference.deviceId); }}>{busy ? microphone.phase === "permission" ? <LoaderCircle className="animate-spin" /> : <Square /> : <Mic />}{busy ? "Stop test" : "Test microphone"}</Button>
        <p className="text-xs leading-relaxed text-muted-foreground">Speak to check the level. Stops after 15 seconds.</p>
      </div>
      {microphone.error && <p role="alert" className="text-sm leading-relaxed text-destructive">{microphone.error}</p>}
    </section>
    <section aria-label="Speaker" className="min-w-0 space-y-4 border-t border-border/60 pt-7 sm:border-t-0 sm:pt-0">
      <h2 id={`${id}-speaker-label`} className="flex items-center gap-2.5 text-sm font-semibold"><Volume2 className="size-4 text-muted-foreground" />Speaker</h2>
      <div className="space-y-2.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button type="button" variant="outline" aria-labelledby={`${id}-speaker-label ${id}-speaker-value`} className="h-auto min-h-12 w-full min-w-0 justify-between gap-3 rounded-xl bg-muted/15 px-3.5 py-3 text-left font-normal whitespace-normal"><span id={`${id}-speaker-value`} className="min-w-0 break-words">{speakerLabel}</span><ChevronDown className="size-4 shrink-0 text-muted-foreground" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" aria-label="Speaker devices" className="w-(--radix-dropdown-menu-trigger-width) max-w-[calc(100vw-4rem)]">
          <DropdownMenuRadioGroup value={output.deviceId} onValueChange={(value) => { speaker.stop(); output.select(value); }}>
            <DropdownMenuRadioItem value="" className="min-h-11 whitespace-normal">System default</DropdownMenuRadioItem>
            {missingSpeaker && <DropdownMenuRadioItem value={output.deviceId} disabled className="min-h-11 whitespace-normal">Saved speaker (not listed)</DropdownMenuRadioItem>}
            {speaker.canRoute && speaker.devices.map((device) => <DropdownMenuRadioItem key={device.id} value={device.id} className="min-h-11 py-2.5 whitespace-normal"><span className="min-w-0 break-words">{device.label}</span></DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="text-xs leading-relaxed text-muted-foreground">{!speaker.canRoute ? "Use System default, then choose an output in your device’s sound settings." : missingSpeaker ? "Your saved speaker may need permission or be disconnected." : "Where Sift’s replies play."}</p>
      </div>
      {!voiceBusy && <div className="flex min-h-11 flex-wrap items-center gap-x-2"><Button type="button" variant="ghost" size="sm" className="-ml-2 min-h-11 px-2 text-muted-foreground" disabled={speakerBusy} onClick={() => void speaker.refresh()}><RefreshCw />Refresh speakers</Button>{speaker.canChoose && speaker.canRoute && <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2 text-muted-foreground" disabled={speakerBusy} onClick={() => void speaker.choose()}>Choose in browser</Button>}</div>}
      <div className="space-y-4 rounded-xl bg-muted/30 p-4">
        <p className="flex items-center gap-2 text-sm font-medium"><Volume2 className="size-4 text-muted-foreground" />Test output</p>
        <p aria-live="polite" className="min-h-8 text-xs leading-relaxed text-muted-foreground">{speaker.phase === "testing" ? "Playing a short tone through your selected speaker." : speaker.phase === "starting" ? "Starting the test sound…" : speaker.phase === "choosing" ? "Choose a speaker in the browser prompt." : "Play a short tone through your selected speaker."}</p>
        <Button type="button" variant="outline" size="sm" className="min-h-11 w-full bg-background" disabled={voiceBusy} onClick={() => { microphone.stop(); if (speakerBusy) speaker.stop(); else void speaker.play(output.deviceId); }}>{speakerBusy ? <Square /> : <Volume2 />}{speakerBusy ? speaker.phase === "choosing" ? "Cancel speaker selection" : "Stop test sound" : "Play test sound"}</Button>
      </div>
      {speaker.error && <p role="alert" className="text-sm leading-relaxed text-destructive">{speaker.error}</p>}
    </section>
    </div>
    <p className="mt-7 border-t border-border/60 pt-5 text-xs leading-relaxed text-muted-foreground">Choices are saved in this browser. Tests stay on your device, aren’t recorded, and use no voice credits.</p>
  </div>;
}
