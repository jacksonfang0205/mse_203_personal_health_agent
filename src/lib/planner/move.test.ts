import { describe, expect, it } from "vitest";
import type { Workout } from "../schemas";
import { canFinishOn } from "../store";
import { moveWorkout, rationaleFor } from "./move";

// 2026-11-25 is a Wednesday, 2026-11-26 a Thursday.
const base = {
  id: "w1",
  date: "2026-11-25",
  start: "07:00",
  rationale: "Strength work toward your goal to get stronger. Placed in your free early morning on Wednesday, clear of your calendar.",
} as unknown as Workout;

describe("moving a workout", () => {
  it("updates the day and time in its description", () => {
    const moved = moveWorkout(base, "2026-11-26", "18:00");
    expect(moved.date).toBe("2026-11-26");
    expect(moved.rationale).toContain("on Thursday");
    expect(moved.rationale).not.toContain("Wednesday");
    expect(moved.rationale).toContain("free evening on Thursday");
    expect(moved.rationale).not.toContain("early");
  });

  it("swaps day names in free-form descriptions too", () => {
    const w = { ...base, rationale: "Legs on Wed so they recover before Saturday." } as Workout;
    expect(moveWorkout(w, "2026-11-26", "07:00").rationale).toBe("Legs on Thu so they recover before Saturday.");
  });

  it("corrects a description that was left behind by an earlier move", () => {
    const stale = { ...base, date: "2026-11-26" } as Workout;
    expect(rationaleFor(stale)).toContain("on Thursday");
  });
});

describe("finishing a workout", () => {
  it("is only allowed on the workout's own day", () => {
    expect(canFinishOn({ date: "2026-11-25" }, "2026-11-25")).toBe(true);
    expect(canFinishOn({ date: "2026-11-30" }, "2026-11-25")).toBe(false);
    expect(canFinishOn({ date: "2026-11-24" }, "2026-11-25")).toBe(false);
  });
});
