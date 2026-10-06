"use client";

import { AlertCircle, AudioLines, LoaderCircle, MicOff, PhoneOff, SlidersHorizontal } from "lucide-react";
import type { SiftVoice, VoicePhase } from "./use-voice-session";
import { SiftMark } from "./brand";
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

/**
 * One launcher: the Sift orb opens the conversation, and a voice key docked
 * to its side starts or ends live voice. While voice is on, the orb itself
 * becomes the voice indicator and the dock grows to show status and controls.
 */
export function VoiceLauncher({ voice, hidden, disabled, replying, onDetails }: { voice: SiftVoice; hidden: boolean; disabled: boolean; replying: boolean; onDetails: () => void }) {
  const visible = voice.busy || !!voice.error || !!voice.notice || !!voice.playbackError;
  const live = voice.busy && ["listening", "thinking", "speaking", "muted", "updating"].includes(voice.phase);
  const problem = !!voice.error || !!voice.playbackError;
  return <div hidden={hidden} role="group" aria-label="Sift controls" data-live={live || undefined} data-busy={voice.busy || undefined} data-phase={voice.phase} className={styles.launcher}>
    <div className={styles.dock}>
      {visible && <p role="status" className={`${styles.status} ${problem && !voice.busy ? styles.problem : ""}`}>{voiceLabels[voice.phase]}</p>}
      {visible && <button type="button" aria-label="Voice controls" title="Voice controls" className={styles.key} onClick={onDetails}>
        {problem ? <AlertCircle className="size-[18px]" /> : <SlidersHorizontal className="size-[17px]" />}
      </button>}
      <button type="button" aria-label={voice.busy ? "End voice" : "Start voice with Sift"} title={voice.busy ? "End voice" : "Live voice conversation (ElevenLabs)"}
        disabled={voice.phase === "ending" || (!voice.busy && disabled)} onClick={() => { if (voice.busy) void voice.end(); else void voice.start(); }}
        className={`${styles.key} ${voice.busy ? styles.end : ""}`}>
        {voice.busy ? <PhoneOff className="size-[17px]" /> : <AudioLines className="size-[18px]" />}
      </button>
      <SheetTrigger asChild>
        <button type="button" aria-label="Open Sift" title="Open conversation" aria-controls="sift-chat" className={styles.orb}>
          <span aria-hidden="true" className={styles.halo} />
          <span className={styles.face}>{voice.busy ? <VoiceIndicator phase={voice.phase} /> : <SiftMark className={`size-7 ${styles.mark}`} />}</span>
          {replying && !voice.busy && <span aria-label="Reply in progress" className={styles.replying} />}
        </button>
      </SheetTrigger>
    </div>
  </div>;
}
