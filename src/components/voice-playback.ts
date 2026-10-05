type PlaybackListener = () => void;
type PlaybackRoom = {
  canPlaybackAudio: boolean;
  startAudio: () => Promise<void>;
  on: (event: "audioPlaybackChanged", listener: PlaybackListener) => unknown;
  off: (event: "audioPlaybackChanged", listener: PlaybackListener) => unknown;
};
export type VoicePlaybackBridge = {
  isBlocked: () => boolean;
  subscribe: (listener: PlaybackListener) => () => void;
  resume: () => Promise<void>;
};
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }

/**
 * Compatibility boundary for pinned @elevenlabs/react 1.16 / client 1.26.
 * The public useRawConversation escape hatch exposes the owned conversation,
 * but ElevenLabs does not forward LiveKit's playback status/resume methods.
 * Its WebRTC connection holds the room at connection.room. Validate that shape
 * before using LiveKit's documented APIs; never inspect unrelated DOM audio,
 * patch browser prototypes, or treat an unsupported SDK shape as successful.
 * Room.startAudio plays only that room's attached tracks and resumes its audio
 * context. The caller must invoke resume directly in a click/tap handler.
 */
export function createVoicePlaybackBridge(conversation: unknown): VoicePlaybackBridge | null {
  try {
    if (!record(conversation) || conversation.type !== "voice" || !record(conversation.connection)) return null;
    const room = conversation.connection.room;
    if (!record(room) || typeof room.canPlaybackAudio !== "boolean" || typeof room.startAudio !== "function"
      || typeof room.on !== "function" || typeof room.off !== "function") return null;
    const playback = room as PlaybackRoom;
    return {
      isBlocked: () => !playback.canPlaybackAudio,
      subscribe: (listener) => {
        playback.on("audioPlaybackChanged", listener);
        return () => { playback.off("audioPlaybackChanged", listener); };
      },
      resume: () => playback.startAudio(),
    };
  } catch { return null; }
}

export async function configureVoiceSpeaker(controls: {
  changeOutputDevice: (options: { outputDeviceId: string }) => Promise<void>;
  setVolume: (options: { volume: number }) => void;
}, deviceId: string, isCurrent: () => boolean = () => true) {
  // WebRTC currently ignores the initial outputDeviceId option. Its supported
  // changeOutputDevice method also caches the route for later remote tracks.
  // A fresh connection already uses the system default; an empty change is a
  // SDK no-op, so skip it. A failed explicit route must not silently fall back.
  if (!isCurrent()) return;
  if (deviceId) await controls.changeOutputDevice({ outputDeviceId: deviceId });
  if (isCurrent()) controls.setVolume({ volume: 1 });
}

export async function validateVoiceSpeaker(deviceId: string) {
  if (!deviceId) return;
  // An unattached element has no source and never plays. It validates browser
  // permission and device availability before a billable token is requested;
  // the SDK cannot do this until its first remote track has been attached.
  const probe = document.createElement("audio");
  if (typeof probe.setSinkId !== "function") throw new Error("Output selection is unsupported.");
  await probe.setSinkId(deviceId);
}

export function watchVoiceSpeaker(deviceId: string, isCurrent: () => boolean, onUnavailable: (message: string) => void) {
  const devices = navigator.mediaDevices;
  if (!deviceId || !devices) return () => undefined;
  let disposed = false, checking = 0;
  const current = (check: number) => !disposed && check === checking && isCurrent();
  const changed = () => {
    const check = ++checking;
    void (async () => {
      try {
        const available = await devices.enumerateDevices();
        if (!current(check)) return;
        if (!available.some((device) => device.kind === "audiooutput" && device.deviceId === deviceId)) throw new DOMException("Selected output is unavailable", "NotFoundError");
        await validateVoiceSpeaker(deviceId);
      } catch (error) {
        if (current(check)) onUnavailable(voiceSpeakerError(error));
      }
    })();
  };
  // The pinned SDK catches sink failures during remote-track attachment. A
  // devicechange check ends clearly on unplug/revocation, but cannot promise
  // zero samples on the default sink during that provider/browser race.
  devices.addEventListener("devicechange", changed);
  return () => { disposed = true; devices.removeEventListener("devicechange", changed); };
}

export function voiceSpeakerError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "The selected speaker isn’t available. Choose another speaker in Audio settings, then reconnect voice.";
  if (name === "NotAllowedError" || name === "SecurityError") return "Speaker access is blocked. Allow it in your browser or choose another speaker in Audio settings, then reconnect voice.";
  return "Sift couldn’t use the selected speaker. Choose a speaker in Audio settings and test it, then reconnect voice.";
}
