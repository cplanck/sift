import { afterEach, describe, expect, it, vi } from "vitest";
import { configureVoiceSpeaker, createVoicePlaybackBridge, validateVoiceSpeaker, voiceSpeakerError, watchVoiceSpeaker } from "@/components/voice-playback";

afterEach(() => { vi.unstubAllGlobals(); });

function ownedConversation() {
  const listeners = new Set<() => void>();
  const room = {
    canPlaybackAudio: false,
    startAudio: vi.fn(async () => { room.canPlaybackAudio = true; listeners.forEach((listener) => listener()); }),
    on: vi.fn((_event: string, listener: () => void) => { listeners.add(listener); }),
    off: vi.fn((_event: string, listener: () => void) => { listeners.delete(listener); }),
  };
  return { conversation: { type: "voice", connection: { room } }, room, listeners };
}

describe("The owned ElevenLabs WebRTC playback bridge", () => {
  it("subscribes to the installed LiveKit event and removes exactly its listener", () => {
    const { conversation, room, listeners } = ownedConversation(), unrelated = vi.fn(), changed = vi.fn();
    listeners.add(unrelated);
    const bridge = createVoicePlaybackBridge(conversation)!;
    expect(bridge.isBlocked()).toBe(true);
    const unsubscribe = bridge.subscribe(changed);
    expect(room.on).toHaveBeenCalledWith("audioPlaybackChanged", changed);
    room.canPlaybackAudio = true; listeners.forEach((listener) => listener());
    expect(bridge.isBlocked()).toBe(false);
    expect(changed).toHaveBeenCalledOnce();
    unsubscribe();
    expect(room.off).toHaveBeenCalledWith("audioPlaybackChanged", changed);
    listeners.forEach((listener) => listener());
    expect(changed).toHaveBeenCalledOnce();
    expect(unrelated).toHaveBeenCalledTimes(2);
  });

  it("starts the owned room's audio synchronously inside the user's gesture without touching other audio", async () => {
    const owned = ownedConversation(), unrelated = ownedConversation();
    const bridge = createVoicePlaybackBridge(owned.conversation)!;
    vi.stubGlobal("document", { querySelectorAll: vi.fn(() => { throw new Error("Must not scan page audio"); }) });
    const resuming = bridge.resume();
    expect(owned.room.startAudio).toHaveBeenCalledOnce();
    expect(unrelated.room.startAudio).not.toHaveBeenCalled();
    await resuming;
    expect(bridge.isBlocked()).toBe(false);
    expect(document.querySelectorAll).not.toHaveBeenCalled();
  });

  it("does not turn a denied play request into successful recovery", async () => {
    const { conversation, room } = ownedConversation();
    room.startAudio.mockRejectedValueOnce(new DOMException("private browser details", "NotAllowedError"));
    const bridge = createVoicePlaybackBridge(conversation)!;
    await expect(bridge.resume()).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(bridge.isBlocked()).toBe(true);
  });

  it("fails safely for other transports, missing SDK internals, and incompatible future shapes", () => {
    const { conversation } = ownedConversation();
    for (const candidate of [null, undefined, {}, { ...conversation, type: "text" }, { type: "voice" },
      { type: "voice", connection: { room: { startAudio: vi.fn() } } },
      { type: "voice", connection: { room: { ...conversation.connection.room, canPlaybackAudio: undefined } } },
      { type: "voice", get connection() { throw new Error("Unavailable SDK internals"); } }]) expect(createVoicePlaybackBridge(candidate)).toBeNull();
    expect(conversation.connection.room.startAudio).not.toHaveBeenCalled();
  });

  it("keeps separate connections' playback listeners and recovery isolated", async () => {
    const old = ownedConversation(), current = ownedConversation();
    const oldBridge = createVoicePlaybackBridge(old.conversation)!, newBridge = createVoicePlaybackBridge(current.conversation)!;
    const oldChanged = vi.fn(), newChanged = vi.fn();
    const disposeOld = oldBridge.subscribe(oldChanged), disposeNew = newBridge.subscribe(newChanged);
    disposeOld();
    await oldBridge.resume();
    expect(oldChanged).not.toHaveBeenCalled();
    expect(newChanged).not.toHaveBeenCalled();
    expect(newBridge.isBlocked()).toBe(true);
    await newBridge.resume();
    expect(newChanged).toHaveBeenCalledOnce();
    disposeNew();
    expect(current.listeners.size).toBe(0);
  });
});

describe("Speaker routing uses the supported SDK controls", () => {
  it("waits for the selected output route before setting audible SDK volume", async () => {
    const route = Promise.withResolvers<void>();
    const controls = { changeOutputDevice: vi.fn(() => route.promise), setVolume: vi.fn() };
    const setting = configureVoiceSpeaker(controls, "chosen-speaker");
    expect(controls.changeOutputDevice).toHaveBeenCalledExactlyOnceWith({ outputDeviceId: "chosen-speaker" });
    expect(controls.setVolume).not.toHaveBeenCalled();
    route.resolve(); await setting;
    expect(controls.setVolume).toHaveBeenCalledExactlyOnceWith({ volume: 1 });
  });

  it("uses the system default on a new connection without the SDK's empty-device no-op", async () => {
    const controls = { changeOutputDevice: vi.fn(), setVolume: vi.fn() };
    await configureVoiceSpeaker(controls, "");
    expect(controls.changeOutputDevice).not.toHaveBeenCalled();
    expect(controls.setVolume).toHaveBeenCalledExactlyOnceWith({ volume: 1 });
  });

  it("does not silently fall back after a selected route fails", async () => {
    const controls = { changeOutputDevice: vi.fn().mockRejectedValue(new DOMException("private device ID", "NotFoundError")), setVolume: vi.fn() };
    await expect(configureVoiceSpeaker(controls, "missing-speaker")).rejects.toMatchObject({ name: "NotFoundError" });
    expect(controls.changeOutputDevice).toHaveBeenCalledTimes(1);
    expect(controls.setVolume).not.toHaveBeenCalled();
  });

  it("does not change a replacement connection's volume after old speaker routing settles", async () => {
    const route = Promise.withResolvers<void>();
    const controls = { changeOutputDevice: vi.fn(() => route.promise), setVolume: vi.fn() };
    let current = true;
    const setting = configureVoiceSpeaker(controls, "chosen-speaker", () => current);
    current = false; route.resolve(); await setting;
    expect(controls.setVolume).not.toHaveBeenCalled();
    await configureVoiceSpeaker(controls, "stale-choice", () => false);
    expect(controls.changeOutputDevice).toHaveBeenCalledTimes(1);
  });

  it("validates an explicit output without playback, DOM insertion, or microphone capture", async () => {
    const probe = { setSinkId: vi.fn().mockResolvedValue(undefined), play: vi.fn(), remove: vi.fn() };
    const document = { createElement: vi.fn(() => probe), body: { appendChild: vi.fn() } }, capture = vi.fn();
    vi.stubGlobal("document", document); vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: capture } });
    await validateVoiceSpeaker("");
    expect(document.createElement).not.toHaveBeenCalled();
    await validateVoiceSpeaker("selected-output");
    expect(document.createElement).toHaveBeenCalledExactlyOnceWith("audio");
    expect(probe.setSinkId).toHaveBeenCalledExactlyOnceWith("selected-output");
    expect(probe.play).not.toHaveBeenCalled();
    expect(document.body.appendChild).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("rejects unavailable output selection and gives safe, speaker-specific errors", async () => {
    vi.stubGlobal("document", { createElement: () => ({}) });
    await expect(validateVoiceSpeaker("selected-output")).rejects.toBeDefined();
    for (const name of ["NotFoundError", "NotAllowedError", "SecurityError", "UnknownError"]) {
      const error = new DOMException("private device ID or provider token", name);
      const message = voiceSpeakerError(error);
      expect(message).toContain("speaker");
      expect(message).not.toMatch(/private|token|microphone/);
    }
  });

  it("reports a disconnected selected speaker and unregisters its device listener", async () => {
    const events = new EventTarget(), enumerateDevices = vi.fn().mockResolvedValue([]), ended = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { enumerateDevices, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) } });
    const stop = watchVoiceSpeaker("selected-output", () => true, ended);
    events.dispatchEvent(new Event("devicechange"));
    await vi.waitFor(() => expect(ended).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("selected speaker isn’t available")));
    stop(); events.dispatchEvent(new Event("devicechange"));
    expect(enumerateDevices).toHaveBeenCalledOnce();
  });

  it("reports revoked speaker access without exposing browser details", async () => {
    const events = new EventTarget(), ended = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { enumerateDevices: async () => [{ kind: "audiooutput", deviceId: "selected-output" }], addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) } });
    vi.stubGlobal("document", { createElement: () => ({ setSinkId: async () => { throw new DOMException("private speaker details", "NotAllowedError"); } }) });
    const stop = watchVoiceSpeaker("selected-output", () => true, ended);
    events.dispatchEvent(new Event("devicechange"));
    await vi.waitFor(() => expect(ended).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("Speaker access is blocked")));
    expect(ended.mock.calls[0][0]).not.toContain("private");
    stop();
  });

  it("ignores stale device results and releases pending checks after cleanup or session replacement", async () => {
    const events = new EventTarget(), pending = Promise.withResolvers<unknown[]>(), ended = vi.fn();
    const enumerateDevices = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue([{ kind: "audiooutput", deviceId: "selected-output" }]);
    const setSinkId = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { mediaDevices: { enumerateDevices, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) } });
    vi.stubGlobal("document", { createElement: () => ({ setSinkId }) });
    let current = true;
    const stop = watchVoiceSpeaker("selected-output", () => current, ended);
    events.dispatchEvent(new Event("devicechange"));
    events.dispatchEvent(new Event("devicechange"));
    await vi.waitFor(() => expect(setSinkId).toHaveBeenCalledOnce());
    pending.resolve([]); await pending.promise;
    expect(ended).not.toHaveBeenCalled();
    const afterEnd = Promise.withResolvers<unknown[]>();
    enumerateDevices.mockReturnValueOnce(afterEnd.promise);
    events.dispatchEvent(new Event("devicechange")); current = false; stop();
    afterEnd.resolve([]); await afterEnd.promise;
    expect(ended).not.toHaveBeenCalled();
    expect(setSinkId).toHaveBeenCalledTimes(1);
  });
});
