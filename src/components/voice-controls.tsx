"use client";
import { LoaderCircle, MessageCircle, Mic, MicOff, PhoneOff, RefreshCw, Volume2, X } from "lucide-react";
import type { SiftVoice } from "./use-voice-session";
import { Button } from "./ui/button";
import { MicrophoneSettings } from "./microphone-settings";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { VoiceIndicator, voiceLabels } from "./voice-launcher";

export function VoiceControls({ voice, onTranscript, onText, compact = false }: { voice: SiftVoice; onTranscript: () => void; onText: () => void; compact?: boolean }) {
  return <section aria-label="Sift voice" className="space-y-5">
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/60 p-3">
      <div className="flex min-w-0 items-center gap-2.5"><VoiceIndicator phase={voice.phase} /><p role="status" className="text-sm font-medium">{voiceLabels[voice.phase]}</p></div>
      <MicrophoneSettings voiceBusy={voice.busy} onEndVoice={voice.endForAudioSettings} />
    </div>
    {voice.error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm leading-6 text-destructive">{voice.error}</p>}
    {voice.notice && <p className="text-sm leading-6 text-muted-foreground">{voice.notice}</p>}
    {voice.playbackError && <p role="status" className="text-sm leading-6">{voice.playbackError}</p>}
    {voice.canEnableSpeaker && <Button className="w-full rounded-full" variant={voice.playbackBlocked || voice.playbackError ? "default" : "outline"} disabled={voice.recoveringPlayback} onClick={() => void voice.enableSpeaker()}>{voice.recoveringPlayback ? <LoaderCircle className="animate-spin" /> : <Volume2 />}Enable speaker</Button>}
    {voice.phase === "speaking" && <p className="text-xs text-muted-foreground">Speak to interrupt.</p>}
    {voice.phase === "permission" && <p className="text-xs leading-5 text-muted-foreground">Allow microphone access in your browser, or end voice to cancel.</p>}
    {!compact && voice.caption && <p aria-label="Latest voice transcript" className="line-clamp-3 break-words text-sm leading-6 text-muted-foreground"><span className="font-medium">{voice.caption.speaker}: </span>{voice.caption.text}</p>}
    <div className="grid grid-cols-2 gap-2">
      {voice.busy ? <><Button className="rounded-full" variant="outline" aria-pressed={voice.isMuted} disabled={["checking", "permission", "connecting", "ending", "updating"].includes(voice.phase)} onClick={voice.toggleMute}>{voice.isMuted ? <MicOff /> : <Mic />}{voice.isMuted ? "Unmute" : "Mute"}</Button><Button className="rounded-full" disabled={voice.phase === "ending"} onClick={() => void voice.end()}>{voice.phase === "ending" ? <LoaderCircle className="animate-spin" /> : <PhoneOff />}End voice</Button></>
        : <Button className="col-span-2 rounded-full" onClick={() => void voice.start()}>{voice.error ? <RefreshCw /> : <Mic />}{voice.error ? "Reconnect" : "Start voice"}</Button>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-1 border-t pt-3"><Button className="rounded-full" variant="ghost" size="sm" onClick={onText}><MessageCircle />Use text</Button>{compact && <Button className="rounded-full" variant="ghost" size="sm" onClick={onTranscript}>Transcript</Button>}{!voice.busy && (voice.error || voice.notice) && <Button className="rounded-full" variant="ghost" size="icon" aria-label="Dismiss voice message" onClick={voice.dismiss}><X /></Button>}</div>
    {voice.busy && <p className="text-center text-[11px] leading-5 text-muted-foreground">Voice stays connected until you end it.</p>}
  </section>;
}

export function VoiceDetailsDialog({ open, onOpenChange, voice, onText, onTranscript }: { open: boolean; onOpenChange: (open: boolean) => void; voice: SiftVoice; onText: () => void; onTranscript: () => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[85dvh] overflow-y-auto rounded-3xl p-6 sm:max-w-md"><DialogHeader><DialogTitle>Voice controls</DialogTitle><DialogDescription>Microphone, speaker, and your conversation.</DialogDescription></DialogHeader><VoiceControls voice={voice} compact onTranscript={onTranscript} onText={onText} /></DialogContent></Dialog>;
}
