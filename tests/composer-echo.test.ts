import { describe, expect, it } from "vitest";
import { isSentEcho } from "@/components/composer-echo";

const sent = { text: "What can I make with leeks?", at: 1000 };
describe("dropping a sent message that dictation puts back", () => {
  it("drops the same or nearly the same text arriving at once right after sending", () => {
    expect(isSentEcho("", "What can I make with leeks?", sent, 1500)).toBe(true);
    expect(isSentEcho("", "what can I make with leeks", sent, 1500)).toBe(true);
    expect(isSentEcho("", "What can I make with leeks? Thanks", sent, 1500)).toBe(true);
    expect(isSentEcho("", "What can I make", sent, 1500)).toBe(false);
  });
  it("never blocks typing or new messages", () => {
    expect(isSentEcho("", "W", sent, 1100)).toBe(false);
    expect(isSentEcho("Wha", "What can I make with leeks?", sent, 1100)).toBe(false);
    expect(isSentEcho("", "Something different entirely", sent, 1100)).toBe(false);
    expect(isSentEcho("", "What can I make with leeks?", sent, 4000)).toBe(false);
    expect(isSentEcho("", "What can I make with leeks?", null, 1100)).toBe(false);
  });
});
