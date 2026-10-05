"use client";

import { AlertCircle, LoaderCircle, MessageCircle, MicOff, SlidersHorizontal } from "lucide-react";
import type { SiftVoice, VoicePhase } from "./use-voice-session";
import { SiftMark } from "./brand";
import { Button } from "./ui/button";
import { SheetTrigger } from "./ui/sheet";
import styles from "./voice-launcher.module.css";

export const voiceLabels: Record<VoicePhase, string> = {
  idle: "Voice is off", checking: "Getting voice ready…", permission: "Allow microphone access to begin",
  connecting: "Connecting voice…", updating: "Updating page context…", listening: "Listening",
  thinking: "Thinking…", speaking: "Speaking", muted: "Microphone muted", ending: "Ending voice…", error: "Voice unavailable",
};

export function VoiceIndicator({ phase, small = false }: { phase: VoicePhase; small?: boolean }) {
  const waiting = ["checking", "permission", "connecting", "updating", "ending"].includes(phase);
  return <span aria-hidden="true" data-phase={phase} className={`${styles.indicator} ${small ? styles.small : ""}`}>
    {waiting ? <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />
      : phase === "muted" ? <MicOff className="size-5" />
      : ["listening", "thinking", "speaking"].includes(phase) ? <span className={styles.wave}><i /><i /><i /><i /><i /></span>
      : <SiftMark className={small ? "size-5" : "size-7"} />}
  </span>;
}

export function VoiceLauncher({ voice, hidden, disabled, replying, onDetails }: { voice: SiftVoice; hidden: boolean; disabled: boolean; replying: boolean; onDetails: () => void }) {
  const visible = voice.busy || !!voice.error || !!voice.notice || !!voice.playbackError;
  return <div hidden={hidden} role="group" aria-label="Sift controls" className={styles.launcher}>
    {visible && <p role="status" className={styles.status}>{voiceLabels[voice.phase]}</p>}
    <div className="flex items-center gap-2">
      <Button size="icon" variant="ghost" aria-label={voice.busy ? "End voice" : "Start voice with Sift"} title={voice.busy ? "End voice" : "Talk to Sift"}
        disabled={voice.phase === "ending" || (!voice.busy && disabled)} onClick={() => { if (voice.busy) void voice.end(); else void voice.start(); }} className={styles.primary}>
        <VoiceIndicator phase={voice.phase} />
        {replying && !voice.busy && <span aria-label="Reply in progress" className="absolute right-1 top-1 size-2 rounded-full border-2 border-background bg-foreground" />}
      </Button>
      <div className={styles.secondary}>
        {visible && <Button variant="ghost" size="icon" aria-label="Voice controls" title="Voice controls" className="size-11 rounded-full" onClick={onDetails}>{voice.error || voice.playbackError ? <AlertCircle className="size-[18px]" /> : <SlidersHorizontal className="size-[18px]" />}</Button>}
        <SheetTrigger asChild><Button variant="ghost" size="icon" aria-label="Open Sift" title="Open conversation" aria-controls="sift-chat" className="size-11 rounded-full"><MessageCircle className="size-[19px]" /></Button></SheetTrigger>
      </div>
    </div>
  </div>;
}
