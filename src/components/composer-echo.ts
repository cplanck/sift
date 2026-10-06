const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * True when a change to the just-cleared composer is the sent message coming
 * back: iOS keyboard dictation commits its text after the field was cleared.
 * Typing adds a character at a time, so only a multi-character jump from an
 * empty box that matches the sent text, shortly after sending, counts.
 */
export function isSentEcho(previous: string, next: string, sent: { text: string; at: number } | null, now = Date.now()) {
  if (!sent || previous !== "" || now - sent.at > 2500 || next.trim().length < 4) return false;
  const value = normalize(next), original = normalize(sent.text);
  if (!value || !original) return false;
  if (value === original) return true;
  const [shorter, longer] = value.length < original.length ? [value, original] : [original, value];
  return longer.startsWith(shorter) && shorter.length >= longer.length * 0.6;
}
