"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const preferenceKey = "sift.microphone.v1", preferenceEvent = "sift:microphone-preference", stopEvent = "sift:stop-microphone-test";
let memoryPreference = "", storageUnavailable = false;
function selectedMicrophone() {
  if (storageUnavailable) return memoryPreference;
  try { return window.localStorage.getItem(preferenceKey) ?? ""; }
  catch { return memoryPreference; }
}
function subscribePreference(listener: () => void) {
  const changed = (event: StorageEvent) => { if (event.key === preferenceKey || event.key === null) listener(); };
  window.addEventListener(preferenceEvent, listener); window.addEventListener("storage", changed);
  return () => { window.removeEventListener(preferenceEvent, listener); window.removeEventListener("storage", changed); };
}
export function useMicrophonePreference() {
  const deviceId = useSyncExternalStore(subscribePreference, selectedMicrophone, () => "");
  const select = useCallback((id: string) => {
    if (id.length > 1024) return;
    memoryPreference = id;
    try { if (id) localStorage.setItem(preferenceKey, id); else localStorage.removeItem(preferenceKey); }
    catch { storageUnavailable = true; }
    window.dispatchEvent(new Event(preferenceEvent));
  }, []);
  return { deviceId, select };
}
export function microphoneConstraints(deviceId: string): MediaTrackConstraints | true {
  return deviceId ? { deviceId: { exact: deviceId } } : true;
}
export function stopMicrophoneTest() { window.dispatchEvent(new Event(stopEvent)); }
export function microphoneError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access is blocked. Allow it in your browser’s site settings, then try again. You can keep using text.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "The selected microphone isn’t available. Connect it or choose another microphone.";
  if (name === "NotReadableError") return "Your microphone is unavailable. Check whether another app is using it, then try again.";
  return error instanceof Error ? error.message : "Couldn’t access your microphone. Check your browser settings and try again.";
}
async function audioInputs() {
  if (!navigator.mediaDevices?.enumerateDevices) throw new Error("This browser can’t list microphones. Use a current browser over HTTPS.");
  return (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
}

export function useMicrophoneTest() {
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]), [error, setError] = useState("");
  const [phase, setPhase] = useState<"idle" | "permission" | "testing">("idle"), [level, setLevel] = useState(0), [hasPermission, setHasPermission] = useState(false);
  const mounted = useRef(false), generation = useRef(0), pending = useRef(false);
  const resources = useRef<{ stream?: MediaStream; context?: AudioContext; source?: MediaStreamAudioSourceNode; meter?: AnalyserNode; sample?: ReturnType<typeof setInterval>; timeout?: ReturnType<typeof setTimeout> }>({});
  const release = useCallback(() => {
    generation.current++; pending.current = false;
    const current = resources.current; resources.current = {};
    if (current.sample) clearInterval(current.sample);
    if (current.timeout) clearTimeout(current.timeout);
    current.stream?.getTracks().forEach((track) => track.stop());
    current.source?.disconnect(); current.meter?.disconnect();
    if (current.context) void current.context.close().catch(() => undefined);
  }, []);
  const stop = useCallback(() => { release(); if (mounted.current) { setPhase("idle"); setLevel(0); } }, [release]);
  const refresh = useCallback(() => audioInputs().then((found) => {
      if (!mounted.current) return;
      setDevices(found.filter((device) => device.deviceId && device.deviceId !== "default").map((device, index) => ({ id: device.deviceId, label: device.label || `Microphone ${index + 1}` })));
      setHasPermission(found.some((device) => !!device.label));
    }).catch((error) => { if (mounted.current) setError(microphoneError(error)); }), []);
  const request = useCallback(async (test: boolean, deviceId: string) => {
    if (pending.current) return;
    release(); pending.current = true; const attempt = generation.current;
    setError(""); setLevel(0); setPhase("permission");
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access needs a supported browser over HTTPS.");
      let audioContext: AudioContext | undefined;
      if (test) {
        if (typeof window.AudioContext !== "function") throw new Error("This browser can’t show an input meter. You can still choose a microphone for voice.");
        // Open the audio context inside the explicit tap. Nothing is connected
        // to its destination: this is a local meter, not playback or recording.
        audioContext = new AudioContext(); resources.current.context = audioContext;
        await audioContext.resume();
        if (!mounted.current || generation.current !== attempt) return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(deviceId) });
      if (!mounted.current || generation.current !== attempt) { stream.getTracks().forEach((track) => track.stop()); return; }
      resources.current.stream = stream;
      await refresh();
      if (!mounted.current || generation.current !== attempt) return;
      if (!test || !audioContext) { stop(); return; }
      const source = audioContext.createMediaStreamSource(stream), meter = audioContext.createAnalyser();
      meter.fftSize = 1024; source.connect(meter);
      resources.current.source = source; resources.current.meter = meter;
      const samples = new Float32Array(meter.fftSize);
      resources.current.sample = setInterval(() => {
        meter.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        setLevel(Math.min(100, Math.round(rms * 400)));
      }, 100);
      resources.current.timeout = setTimeout(stop, 15_000);
      stream.getAudioTracks().forEach((track) => track.addEventListener("ended", () => {
        if (mounted.current && generation.current === attempt) { stop(); setError("The microphone disconnected. Choose another microphone and try again."); }
      }, { once: true }));
      setPhase("testing");
    } catch (error) {
      if (mounted.current && generation.current === attempt) { stop(); setError(microphoneError(error)); }
    }
  }, [release, refresh, stop]);
  useEffect(() => {
    mounted.current = true; void refresh();
    const deviceChanged = () => { void refresh(); }, hidden = () => { if (document.hidden) stop(); };
    navigator.mediaDevices?.addEventListener("devicechange", deviceChanged);
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", stop); window.addEventListener(stopEvent, stop);
    return () => {
      mounted.current = false; release();
      navigator.mediaDevices?.removeEventListener("devicechange", deviceChanged);
      document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", stop); window.removeEventListener(stopEvent, stop);
    };
  }, [refresh, release, stop]);
  return { devices, error, phase, level, hasPermission, refresh, stop, request };
}
