import { describe, expect, it } from "vitest";
import { rememberFromMessage } from "./memoryRules";

describe("rule-based memory from Life Happens", () => {
  it("remembers a weekday that is out for good", () => {
    const [b] = rememberFromMessage("I can't do Wednesdays anymore, I have a new lab", []);
    expect(b.days).toEqual(["wed"]);
    expect([b.start, b.end]).toEqual(["06:00", "22:00"]);
  });

  it("ignores one-off changes and part-of-day limits", () => {
    expect(rememberFromMessage("I can't make it this Wednesday", [])).toEqual([]);
    expect(rememberFromMessage("I'm busy every Tuesday evening", [])).toEqual([]);
  });

  it("doesn't repeat a day that's already remembered", () => {
    const first = rememberFromMessage("No longer free on Fridays", []);
    expect(rememberFromMessage("I can never do Fridays", first)).toEqual([]);
  });
});
