import { describe, expect, it } from "vitest";
import { blockedToBusy } from "../calendar";
import { computeInsights, learnedTimeOrder } from "../insights";
import { filterFromProfile } from "../planner/generate";
import type { BlockedTime, FitnessProfile, WorkoutLogEntry } from "../schemas";
import { buildSamplePlan, calendarForWeek, carryOver } from "../session";
import { planCovers } from "../time";
import { validatePlan } from "../validation";
import { assembleWorkout, freeWindows, repairStart } from "./context";

const WEEK = "2026-11-02"; // a Monday
const NOW = { date: WEEK, time: "06:00" };

const profile: FitnessProfile = {
  version: 1,
  goals: ["strength"],
  targetMuscles: [],
  experience: "intermediate",
  workoutTypes: ["home", "running"],
  equipment: ["dumbbells"],
  sessionMinutes: 40,
  frequencyPerWeek: 3,
  preferredDays: ["mon", "wed", "fri"],
  preferredTimes: ["early_morning", "evening"],
  avoidTags: ["overhead"],
  avoidExerciseIds: [],
  avoidNotes: "",
  limitations: "",
  updatedAt: "2026-11-01T00:00:00Z",
};

const blocked = (b: Partial<BlockedTime>): BlockedTime => ({
  id: "b1",
  days: [],
  start: "06:00",
  end: "09:00",
  label: "Commute",
  source: "user",
  createdAt: "2026-11-01T00:00:00Z",
  ...b,
});

describe("blocked times", () => {
  it("expand to busy blocks on matching weekdays and one-off dates", () => {
    const busy = blockedToBusy(
      [blocked({ days: ["mon", "wed"] }), blocked({ id: "b2", date: "2026-11-06", start: "18:00", end: "20:00" })],
      { start: WEEK, end: "2026-11-08" },
    );
    expect(busy.map((b) => b.date)).toEqual(["2026-11-02", "2026-11-04", "2026-11-06"]);
    expect(busy.every((b) => b.source === "blocked")).toBe(true);
  });

  it("keep the template planner out of those times", () => {
    const allMornings = blocked({ days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] });
    const plan = buildSamplePlan({ profile, preset: "open", now: NOW, createdAt: "x", blocked: [allMornings] });
    expect(plan.workouts.length).toBeGreaterThan(0);
    for (const w of plan.workouts) expect(w.start >= "09:00").toBe(true);
    const { busy, knownRange } = calendarForWeek("open", WEEK, [allMornings]);
    expect(validatePlan(plan, { profile, busy, knownRange }).ok).toBe(true);
  });
});

describe("insights", () => {
  const entry = (date: string, start: string, status: "completed" | "skipped"): WorkoutLogEntry => ({
    workoutId: `${date}-${start}`,
    date,
    start,
    durationMin: 30,
    category: "strength",
    status,
    at: "x",
  });

  it("orders preferred windows by what the user actually completes", () => {
    const log = [
      entry("2026-10-26", "07:00", "skipped"),
      entry("2026-10-28", "07:00", "skipped"),
      entry("2026-10-27", "18:00", "completed"),
      entry("2026-10-29", "18:00", "completed"),
    ];
    const insights = computeInsights({ log, history: [], plan: null, now: NOW });
    expect(insights.samples).toBe(4);
    expect(learnedTimeOrder(profile.preferredTimes, insights)).toEqual(["evening", "early_morning"]);
    expect(insights.summary.join(" ")).toMatch(/early morning 0\/2/);
  });

  it("stays out of the way without enough data", () => {
    const insights = computeInsights({ log: [entry("2026-10-26", "07:00", "skipped")], history: [], plan: null, now: NOW });
    expect(learnedTimeOrder(profile.preferredTimes, insights)).toBeUndefined();
  });
});

describe("agent workout assembly", () => {
  const filter = filterFromProfile(profile);
  const spec = {
    date: WEEK,
    start: "18:00",
    category: "strength" as const,
    minutes: 90,
    focus: ["legs" as const],
    title: "Lower body strength",
    rationale: "Strength for your goal.",
  };

  it("drops unknown, ineligible and avoided exercises and caps length", () => {
    const w = assembleWorkout(
      { ...spec, exerciseIds: ["goblet_squat", "made_up_move", "back_squat", "db_shoulder_press", "db_rdl"] },
      { id: "w1", profile, filter },
    )!;
    expect(w.exercises.map((e) => e.exerciseId)).toEqual(["goblet_squat", "db_rdl"]);
    expect(w.durationMin).toBe(40);
    expect(w.origin).toBe("agent");
    const { busy, knownRange } = calendarForWeek("open", WEEK);
    const plan = { id: "p", weekStart: WEEK, workouts: [w], generatedBy: "agent" as const, createdAt: "x", notes: [] };
    expect(validatePlan(plan, { profile, busy, knownRange }).ok).toBe(true);
  });

  it("falls back to the deterministic builder when no picks are usable", () => {
    const w = assembleWorkout({ ...spec, exerciseIds: ["nope"] }, { id: "w2", profile, filter });
    expect(w?.exercises.length).toBeGreaterThan(0);
  });

  it("moves a start that overlaps busy time into a free slot on the same day", () => {
    const w = assembleWorkout({ ...spec, start: "12:00", exerciseIds: ["goblet_squat"] }, { id: "w3", profile, filter })!;
    const { busy } = calendarForWeek("open", "2026-11-02");
    const wed = { ...w, date: "2026-11-04" }; // the "open" preset has lunch 12:00–13:00 on Wednesday
    const fixed = repairStart(wed, busy, [], profile, NOW)!;
    expect(fixed.date).toBe("2026-11-04");
    expect(fixed.start).not.toBe("12:00");
  });

  it("lists free windows around busy time", () => {
    const { busy } = calendarForWeek("open", WEEK);
    expect(freeWindows("2026-11-04", busy, [], NOW)).toEqual(["06:00-11:45", "13:15-22:00"]);
  });
});

describe("rolling 7-day window", () => {
  const SUNDAY = { date: "2026-11-08", time: "07:00" };

  it("plans from today through the next six days", () => {
    const plan = buildSamplePlan({ profile, preset: "open", now: SUNDAY, createdAt: "x" });
    expect(plan.weekStart).toBe("2026-11-08");
    expect(plan.workouts.length).toBe(profile.frequencyPerWeek);
    for (const w of plan.workouts) expect(planCovers(plan, w.date)).toBe(true);
    expect(plan.workouts.some((w) => w.date > "2026-11-08")).toBe(true);
  });

  it("carries completed workouts into a new window and drops ones before it", () => {
    const old = buildSamplePlan({ profile, preset: "open", now: NOW, createdAt: "x" });
    const done = old.workouts.map((w) => ({ ...w, status: "completed" as const }));
    const kept = carryOver({ ...old, workouts: done }, "2026-11-04");
    expect(kept.every((w) => w.date >= "2026-11-04")).toBe(true);
    expect(kept.length).toBe(done.filter((w) => w.date >= "2026-11-04").length);
  });
});
