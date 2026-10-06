"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// Free on-device/OS speech-to-text (Siri dictation on iPhone) via the Web
// Speech API. Unlike live voice, nothing is billed and text lands in the
// composer for review before it is sent.
type Recognizer = {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
type RecognizerClass = new () => Recognizer;
const recognitionClass = (): RecognizerClass | undefined => {
  if (typeof window === "undefined") return undefined;
  const scope = window as unknown as { SpeechRecognition?: RecognizerClass; webkitSpeechRecognition?: RecognizerClass };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
};
const subscribeNever = () => () => undefined;

function dictationError(code: string) {
  if (code === "not-allowed" || code === "service-not-allowed") return "Dictation is blocked. Allow microphone and speech recognition for this site (on iPhone, turn on Siri & Dictation), or use the keyboard’s mic key.";
  if (code === "audio-capture") return "No microphone is available for dictation.";
  if (code === "network") return "Dictation needs a connection. Try again, or use the keyboard’s mic key.";
  return "Dictation stopped. Try again, or use the keyboard’s mic key.";
}

export function useDictation(onText: (text: string) => void) {
  const supported = useSyncExternalStore(subscribeNever, () => !!recognitionClass(), () => false);
  const [listening, setListening] = useState(false), [error, setError] = useState("");
  const active = useRef<Recognizer | null>(null);
  const emit = useRef(onText);
  useEffect(() => { emit.current = onText; }, [onText]);

  const stop = useCallback(() => { active.current?.stop(); }, []);
  const start = useCallback((existing: string) => {
    const Recognition = recognitionClass();
    if (!Recognition || active.current) return;
    const recognition = new Recognition();
    recognition.continuous = true; recognition.interimResults = true; recognition.lang = navigator.language || "en-US";
    const prefix = existing.trim() ? `${existing.trimEnd()} ` : "";
    recognition.onresult = (event) => {
      // Rebuild from every result each time; interim results are replaced in place.
      let transcript = "";
      for (let index = 0; index < event.results.length; index++) transcript += event.results[index][0].transcript;
      emit.current(prefix + transcript.trimStart());
    };
    recognition.onerror = (event) => { if (event.error !== "no-speech" && event.error !== "aborted") setError(dictationError(event.error)); };
    recognition.onend = () => { if (active.current === recognition) { active.current = null; setListening(false); } };
    active.current = recognition; setError(""); setListening(true);
    try { recognition.start(); }
    catch { active.current = null; setListening(false); setError(dictationError("")); }
  }, []);
  useEffect(() => () => { const current = active.current; active.current = null; current?.abort(); }, []);
  return { supported, listening, error, start, stop, dismiss: () => setError("") };
}
