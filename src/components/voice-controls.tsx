"use client";
import { LoaderCircle, MessageCircle, Mic, MicOff, PhoneOff, RefreshCw, X } from "lucide-react";
import type { SiftVoice } from "./use-voice-session";
import { SiftMark } from "./brand";
import { Button } from "./ui/button";
import { MicrophoneSettings } from "./microphone-settings";

const labels = { idle: "Voice is off", checking: "Getting voice ready…", permission: "Allow microphone access to begin", connecting: "Connecting voice…", updating: "Updating page context…", listening: "Listening", thinking: "Thinking…", speaking: "Speaking", muted: "Microphone muted", ending: "Ending voice…", error: "Voice unavailable" };
export function VoiceControls({ voice, onTranscript, onText, compact = false }: { voice: SiftVoice; onTranscript: () => void; onText: () => void; compact?: boolean }) {
  return <section aria-label="Sift voice" className="space-y-3 rounded-2xl border bg-background p-4 shadow-sm">
    <div className="flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><SiftMark className="size-5 shrink-0" /><p role="status" className="text-sm font-medium">{labels[voice.phase]}</p></div><div className="flex shrink-0 items-center"><MicrophoneSettings voiceBusy={voice.busy} />{!voice.busy && <Button variant="ghost" size="icon" className="shrink-0" aria-label="Dismiss voice message" onClick={voice.dismiss}><X /></Button>}</div></div>
    {voice.error && <p role="alert" className="text-sm leading-relaxed text-destructive">{voice.error}</p>}
    {voice.notice && <p className="text-xs leading-relaxed text-muted-foreground">{voice.notice}</p>}
    {voice.phase === "speaking" && <p className="text-xs text-muted-foreground">You can interrupt Sift by speaking.</p>}
    {voice.phase === "permission" && <p className="text-xs leading-relaxed text-muted-foreground">Sift uses your microphone only while voice is on. You can mute it or end the conversation at any time.</p>}
    {!compact && voice.caption && <p aria-label="Latest voice transcript" className="line-clamp-3 break-words text-xs leading-relaxed text-muted-foreground"><span className="font-medium">{voice.caption.speaker}: </span>{voice.caption.text}</p>}
    <div className="flex flex-wrap items-center gap-1.5">{voice.busy ? <><Button variant="outline" size="sm" aria-pressed={voice.isMuted} disabled={["checking", "permission", "connecting", "ending", "updating"].includes(voice.phase)} onClick={voice.toggleMute}>{voice.isMuted ? <MicOff /> : <Mic />}{voice.isMuted ? "Unmute" : "Mute"}</Button><Button variant="outline" size="sm" disabled={voice.phase === "ending"} onClick={() => void voice.end()}>{voice.phase === "ending" ? <LoaderCircle className="animate-spin" /> : <PhoneOff />}End voice</Button></> : voice.error && <Button variant="outline" size="sm" onClick={() => void voice.start()}><RefreshCw />Reconnect</Button>}<Button variant="ghost" size="sm" onClick={onText}><MessageCircle />Use text</Button>{compact && <Button variant="ghost" size="sm" onClick={onTranscript}>Transcript</Button>}</div>
  </section>;
}
