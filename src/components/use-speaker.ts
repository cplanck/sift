"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const preferenceKey = "sift.speaker.v1", preferenceEvent = "sift:speaker-preference", stopEvent = "sift:stop-speaker-test";
let memoryPreference = "", storageUnavailable = false;
function selectedSpeaker() {
  if (storageUnavailable) return memoryPreference;
  try { return window.localStorage.getItem(preferenceKey) ?? ""; }
  catch { return memoryPreference; }
}
function subscribePreference(listener: () => void) {
  const changed = (event: StorageEvent) => { if (event.key === preferenceKey || event.key === null) listener(); };
  window.addEventListener(preferenceEvent, listener); window.addEventListener("storage", changed);
  return () => { window.removeEventListener(preferenceEvent, listener); window.removeEventListener("storage", changed); };
}
export function useSpeakerPreference() {
  const deviceId = useSyncExternalStore(subscribePreference, selectedSpeaker, () => "");
  const select = useCallback((value: string) => {
    if (value.length > 1024) return;
    const id = value === "default" ? "" : value;
    memoryPreference = id;
    try { if (id) localStorage.setItem(preferenceKey, id); else localStorage.removeItem(preferenceKey); }
    catch { storageUnavailable = true; }
    window.dispatchEvent(new Event(preferenceEvent));
  }, []);
  return { deviceId, select };
}
export function stopSpeakerTest() { window.dispatchEvent(new Event(stopEvent)); }

type OutputDevices = MediaDevices & { selectAudioOutput?: (options?: { deviceId?: string }) => Promise<MediaDeviceInfo> };
const subscribeCapability = () => () => {};
const supportsRouting = () => typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
const supportsChooser = () => typeof navigator !== "undefined" && typeof (navigator.mediaDevices as OutputDevices | undefined)?.selectAudioOutput === "function";
function speakerError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Speaker access or playback was blocked. Allow sound for this site and choose the speaker again.";
  if (name === "NotFoundError") return "That speaker isn’t available. Connect it or choose another output.";
  if (name === "NotSupportedError") return "This browser can’t use the selected speaker. Choose System default or use a browser that supports speaker selection.";
  return "Couldn’t play through that speaker. Check your browser and device sound settings, then try again.";
}
async function audioOutputs() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  return (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audiooutput" && device.deviceId && device.deviceId !== "default");
}

export function useSpeakerTest(onChoose: (id: string) => void) {
  const canRoute = useSyncExternalStore(subscribeCapability, supportsRouting, () => false);
  const canChoose = useSyncExternalStore(subscribeCapability, supportsChooser, () => false);
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]), [error, setError] = useState("");
  const [phase, setPhase] = useState<"idle" | "choosing" | "starting" | "testing">("idle");
  const mounted = useRef(false), generation = useRef(0), enumeration = useRef(0);
  const resources = useRef<{ audio?: HTMLAudioElement; context?: AudioContext; oscillator?: OscillatorNode; gain?: GainNode; stream?: MediaStream; timer?: ReturnType<typeof setTimeout> }>({});
  const release = useCallback(() => {
    generation.current++; enumeration.current++;
    const current = resources.current; resources.current = {};
    if (current.timer) clearTimeout(current.timer);
    if (current.audio) { current.audio.pause(); current.audio.srcObject = null; current.audio.remove(); }
    if (current.oscillator) { try { current.oscillator.stop(); } catch { /* It may already have stopped. */ } current.oscillator.disconnect(); }
    current.gain?.disconnect();
    current.stream?.getTracks().forEach((track) => track.stop());
    if (current.context) void current.context.close().catch(() => undefined);
  }, []);
  const stop = useCallback(() => { release(); if (mounted.current) setPhase("idle"); }, [release]);
  const refresh = useCallback(() => {
    const attempt = ++enumeration.current;
    return audioOutputs().then((found) => {
      if (mounted.current && attempt === enumeration.current) setDevices(found.map((device, index) => ({ id: device.deviceId, label: device.label || `Speaker ${index + 1}` })));
    }).catch((error) => { if (mounted.current && attempt === enumeration.current) setError(speakerError(error)); });
  }, []);
  const choose = useCallback(async () => {
    release(); const attempt = generation.current;
    setError(""); setPhase("choosing");
    try {
      const media = navigator.mediaDevices as OutputDevices;
      if (!media?.selectAudioOutput) throw new DOMException("Unsupported speaker chooser", "NotSupportedError");
      // Called directly from the explicit button so the browser can ask for
      // output permission without opening a microphone or provider session.
      const selected = await media.selectAudioOutput();
      if (!mounted.current || generation.current !== attempt) return;
      onChoose(selected.deviceId);
      await refresh();
      if (mounted.current && generation.current === attempt) stop();
    } catch (error) { if (mounted.current && generation.current === attempt) { stop(); setError(speakerError(error)); } }
  }, [onChoose, refresh, release, stop]);
  const play = useCallback(async (deviceId: string) => {
    release(); const attempt = generation.current;
    setError(""); setPhase("starting");
    try {
      if (typeof AudioContext !== "function" || (deviceId && !supportsRouting())) throw new DOMException("Unsupported speaker test", "NotSupportedError");
      const context = new AudioContext(), audio = new Audio();
      resources.current = { context, audio };
      // Unlock on the user's tap. The oscillator is routed only through our
      // own media element, never directly to the system-default destination.
      const resumed = context.resume();
      const destination = context.createMediaStreamDestination();
      resources.current.stream = destination.stream;
      audio.srcObject = destination.stream;
      audio.hidden = true; audio.dataset.siftSpeakerTest = "true";
      document.body.appendChild(audio);
      await resumed;
      if (!mounted.current || generation.current !== attempt) return;
      if (deviceId) await audio.setSinkId(deviceId);
      if (!mounted.current || generation.current !== attempt) return;
      const oscillator = context.createOscillator(), gain = context.createGain();
      resources.current.oscillator = oscillator; resources.current.gain = gain;
      oscillator.frequency.value = 440;
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(0.1, context.currentTime + 0.03);
      gain.gain.setTargetAtTime(0, context.currentTime + 0.8, 0.04);
      oscillator.connect(gain); gain.connect(destination); oscillator.start();
      resources.current.timer = setTimeout(stop, 1100);
      await audio.play();
      if (!mounted.current || generation.current !== attempt) return;
      setPhase("testing");
    } catch (error) { if (mounted.current && generation.current === attempt) { stop(); setError(speakerError(error)); } }
  }, [release, stop]);
  useEffect(() => {
    mounted.current = true; void refresh();
    const changed = () => { void refresh(); }, hidden = () => { if (document.hidden) stop(); };
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    window.addEventListener(stopEvent, stop); window.addEventListener("pagehide", stop); document.addEventListener("visibilitychange", hidden);
    return () => {
      mounted.current = false; release();
      navigator.mediaDevices?.removeEventListener("devicechange", changed);
      window.removeEventListener(stopEvent, stop); window.removeEventListener("pagehide", stop); document.removeEventListener("visibilitychange", hidden);
    };
  }, [refresh, release, stop]);
  return { devices, canRoute, canChoose, phase, error, refresh, choose, play, stop };
}
