"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRawConversation } from "@elevenlabs/react";
import { createVoicePlaybackBridge, type VoicePlaybackBridge } from "./voice-playback";

const subscribeIdle = () => () => undefined, notBlocked = () => false;
const blockedMessage = "Your browser paused Sift’s audio. Select Enable speaker to hear replies.";
export function useVoicePlayback(active: boolean) {
  const conversation = useRawConversation();
  const bridge = useMemo(() => active ? createVoicePlaybackBridge(conversation) : null, [active, conversation]);
  const playbackBlocked = useSyncExternalStore(bridge?.subscribe ?? subscribeIdle, bridge?.isBlocked ?? notBlocked, notBlocked);
  const current = useRef<VoicePlaybackBridge | null>(null);
  const [recovery, setRecovery] = useState<{ bridge: VoicePlaybackBridge; pending: boolean; error: string } | null>(null);
  useEffect(() => {
    current.current = bridge;
    return () => { if (current.current === bridge) current.current = null; };
  }, [bridge]);
  const enableSpeaker = useCallback(async () => {
    if (!bridge || current.current !== bridge) return;
    setRecovery({ bridge, pending: true, error: "" });
    try {
      // No await before this call: browser user activation belongs to the tap.
      await bridge.resume();
      if (current.current === bridge) setRecovery({ bridge, pending: false, error: bridge.isBlocked() ? blockedMessage : "" });
    } catch {
      if (current.current === bridge) setRecovery({ bridge, pending: false, error: "Sift’s audio is still blocked. Allow sound in your browser’s site settings, or test another speaker in Audio settings." });
    }
  }, [bridge]);
  const ownRecovery = recovery?.bridge === bridge ? recovery : null;
  return {
    canEnableSpeaker: !!bridge,
    playbackBlocked,
    recoveringPlayback: ownRecovery?.pending ?? false,
    playbackError: ownRecovery?.error || (playbackBlocked ? blockedMessage : active && conversation && !bridge ? "Playback recovery isn’t available for this connection. End voice, test your speaker in Audio settings, and reconnect." : ""),
    enableSpeaker,
  };
}
