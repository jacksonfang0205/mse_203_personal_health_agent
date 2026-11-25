import { describe, expect, it } from "vitest";
import { AppState } from "./appState";
import {
  estimatedMax,
  formatSets,
  formatTarget,
  isLoggable,
  parseRepRange,
  sessionsFor,
  suggestTarget,
  type Session,
} from "./progression";
import type { ExerciseLog, LoggedSet } from "./schemas";

const sets = (...xs: [number, number | null][]): LoggedSet[] => xs.map(([reps, weight]) => ({ reps, weight }));
const session = (date: string, s: LoggedSet[], unit: "lb" | "kg" = "lb"): Session => ({ date, unit, sets: s });

const goblet = { exerciseId: "goblet_squat", sets: 3, reps: "8–12" }; // lower body, dumbbell
const dbBench = { exerciseId: "db_bench", sets: 3, reps: "8–12" }; // upper body, dumbbell
const pushUp = { exerciseId: "push_up", sets: 3, reps: "8–12" }; // bodyweight
const plank = { exerciseId: "plank", sets: 3, seconds: 30 };

describe("parseRepRange", () => {
  it("reads ranges, single numbers and per-side notes", () => {
    expect(parseRepRange("8–12")).toEqual({ lo: 8, hi: 12 });
    expect(parseRepRange("8-10")).toEqual({ lo: 8, hi: 10 });
    expect(parseRepRange("10 / side")).toEqual({ lo: 10, hi: 10 });
    expect(parseRepRange(undefined)).toBeNull();
  });
});

describe("isLoggable", () => {
  it("logs rep and hold movements, not timed cardio blocks", () => {
    expect(isLoggable(goblet)).toBe(true);
    expect(isLoggable(plank)).toBe(true);
    expect(isLoggable({ exerciseId: "easy_run", minutes: 25 })).toBe(false);
  });
});

describe("suggestTarget", () => {
  it("gives a starting point with no history", () => {
    const t = suggestTarget(goblet, [], "lb");
    expect(t.kind).toBe("first");
    expect(t.weight).toBeNull();
    expect(t.reason).toMatch(/2 reps left/);
  });

  it("adds weight once every set reaches the top of the range (lower body ≈5%, at least one step)", () => {
    const t = suggestTarget(goblet, [session("2026-11-18", sets([12, 40], [12, 40], [12, 40]))], "lb");
    expect(t.kind).toBe("increase_weight");
    expect(t.weight).toBe(45);
    expect(t.reps).toBe(8);
    expect(formatTarget(t)).toBe("3 × 8 @ 45 lb");
  });

  it("uses smaller jumps for upper body on heavier loads", () => {
    const lower = suggestTarget({ exerciseId: "back_squat", sets: 4, reps: "5–8" }, [session("d", sets([8, 200], [8, 200], [8, 200], [8, 200]))], "lb");
    const upper = suggestTarget({ exerciseId: "bench_press", sets: 4, reps: "6–8" }, [session("d", sets([8, 200], [8, 200], [8, 200], [8, 200]))], "lb");
    expect(lower.weight).toBe(210);
    expect(upper.weight).toBe(205);
  });

  it("adds a rep per set inside the range at the same weight", () => {
    const t = suggestTarget(dbBench, [session("2026-11-18", sets([10, 30], [9, 30], [9, 30]))], "lb");
    expect(t.kind).toBe("add_reps");
    expect(t.weight).toBe(30);
    expect(t.reps).toBe(10);
  });

  it("doesn't add weight when a set was missed", () => {
    const t = suggestTarget(dbBench, [session("2026-11-18", sets([12, 30], [12, 30]))], "lb");
    expect(t.kind).not.toBe("increase_weight");
  });

  it("repeats the weight after one session under the range, then deloads after two", () => {
    const miss = session("2026-11-18", sets([8, 50], [7, 50], [6, 50]));
    expect(suggestTarget(dbBench, [miss], "lb")).toMatchObject({ kind: "repeat", weight: 50, reps: 8 });
    const t = suggestTarget(dbBench, [miss, session("2026-11-15", sets([7, 50], [6, 50], [6, 50]))], "lb");
    expect(t.kind).toBe("deload");
    expect(t.weight).toBe(45);
  });

  it("converts between units", () => {
    const t = suggestTarget(goblet, [session("d", sets([12, 20], [12, 20], [12, 20]), "kg")], "lb");
    expect(t.kind).toBe("increase_weight");
    expect(t.weight).toBeGreaterThan(44);
  });

  it("progresses bodyweight work with reps", () => {
    expect(suggestTarget(pushUp, [session("d", sets([9, null], [8, null], [8, null]))], "lb")).toMatchObject({ kind: "add_reps", reps: 9, weight: null });
    expect(suggestTarget(pushUp, [session("d", sets([12, null], [12, null], [13, null]))], "lb")).toMatchObject({ reps: 14 });
  });

  it("adds 5 seconds to holds once every set is held", () => {
    expect(suggestTarget(plank, [session("d", sets([30, null], [30, null], [30, null]))], "lb")).toMatchObject({ kind: "add_seconds", reps: 35 });
    expect(suggestTarget(plank, [session("d", sets([30, null], [20, null], [25, null]))], "lb")).toMatchObject({ kind: "repeat", reps: 30 });
  });
});

describe("sessionsFor", () => {
  const log = (date: string, s: (LoggedSet | null)[], exerciseId = "goblet_squat"): ExerciseLog => ({
    workoutId: `w-${date}`,
    exerciseIndex: 0,
    exerciseId,
    date,
    unit: "lb",
    sets: s,
    at: `${date}T10:00:00Z`,
  });

  it("returns past sessions for the exercise, newest first, skipping empty sets and today", () => {
    const lifts = [
      log("2026-11-11", [{ reps: 10, weight: 35 }, null]),
      log("2026-11-18", [{ reps: 12, weight: 40 }]),
      log("2026-11-25", [{ reps: 8, weight: 45 }]),
      log("2026-11-17", [{ reps: 10, weight: 20 }], "db_row"),
      log("2026-11-16", [null]),
    ];
    const out = sessionsFor(lifts, "goblet_squat", "2026-11-25");
    expect(out.map((s) => s.date)).toEqual(["2026-11-18", "2026-11-11"]);
    expect(out[1].sets).toHaveLength(1);
  });
});

describe("formatting", () => {
  it("summarises sets", () => {
    expect(formatSets(sets([10, 25], [10, 25], [10, 25]), "lb")).toBe("3 × 10 @ 25 lb");
    expect(formatSets(sets([10, 25], [9, 25]), "lb")).toBe("10, 9 reps @ 25 lb");
    expect(formatSets(sets([10, null], [10, null]), "lb")).toBe("2 × 10");
  });

  it("estimates a one-rep max from the best set", () => {
    expect(estimatedMax(sets([10, 30], [5, 40]))).toBeCloseTo(46.67, 1);
    expect(estimatedMax(sets([10, null]))).toBeNull();
  });
});

describe("AppState", () => {
  it("keeps state saved before lift logging valid", () => {
    const old = { version: 1, profile: null, plan: null, history: [], calendarPreset: "student" };
    const parsed = AppState.parse(old);
    expect(parsed.lifts).toEqual([]);
    expect(parsed.weightUnit).toBe("lb");
  });
});
