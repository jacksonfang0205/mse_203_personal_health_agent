import { describe, expect, it } from "vitest";
import { blockedToBusy } from "../calendar";
import { dayCapacity, fitMinutes } from "../capacity";
import { computeInsights } from "../insights";
import { applyOperations } from "../planner/alternatives";
import { filterFromProfile } from "../planner/generate";
import type { BlockedTime, FitnessProfile, WeeklyPlan, WorkoutLogEntry } from "../schemas";
import { buildSamplePlan, calendarForWeek } from "../session";
import { validatePlan } from "../validation";
import { assembleWorkout, fitsDay, type AgentRequest } from "./context";
import { resolveCollateral } from "./lifeHappens";

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
  preferredTimes: [],
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

describe("day capacity", () => {
  it("is the longest free stretch, with breathing room around events", () => {
    const { busy } = calendarForWeek("open", WEEK); // lunch 12:00–13:00 on Wednesday
    expect(dayCapacity("2026-11-04", busy)).toBe(22 * 60 - (13 * 60 + 15)); // 13:15–22:00 beats 06:00–11:45
    expect(dayCapacity("2026-11-04", busy, "14:00")).toBe(8 * 60); // 14:00–22:00
  });

  it("shortens sessions on busy days and drops tiny gaps", () => {
    expect(fitMinutes(45, 120)).toBe(45);
    expect(fitMinutes(45, 32)).toBe(30);
    expect(fitMinutes(45, 10)).toBe(0);
  });
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

  it("keep the template planner off days the user can't make", () => {
    const allDay = blocked({ days: ["mon", "wed"], start: "00:00", end: "23:59" });
    const plan = buildSamplePlan({ profile, preset: "open", now: NOW, createdAt: "x", blocked: [allDay] });
    expect(plan.workouts.length).toBe(3);
    expect(plan.workouts.map((w) => w.date)).not.toContain("2026-11-02");
    expect(plan.workouts.map((w) => w.date)).not.toContain("2026-11-04");
    const { busy, knownRange } = calendarForWeek("open", WEEK, [allDay]);
    expect(validatePlan(plan, { profile, busy, knownRange }).ok).toBe(true);
  });
});

describe("insights", () => {
  const entry = (date: string, time: string, status: "completed" | "skipped"): WorkoutLogEntry => ({
    workoutId: `${date}-${time}`,
    date,
    durationMin: 30,
    category: "strength",
    status,
    time,
    at: "x",
  });

  it("learns when the user actually checks workouts off", () => {
    const log = [
      entry("2026-10-26", "18:30", "completed"),
      entry("2026-10-28", "19:10", "completed"),
      entry("2026-10-29", "07:00", "completed"),
      entry("2026-10-30", "18:00", "skipped"),
    ];
    const insights = computeInsights({ log, history: [], plan: null, now: NOW });
    expect(insights.samples).toBe(4);
    expect(insights.summary.join(" ")).toMatch(/evening \(2 of 3 completed\)/);
  });

  it("counts planned workouts on past days as missed", () => {
    const plan = {
      workouts: [{ id: "x", date: "2026-10-30", status: "planned", category: "cardio", durationMin: 30 }],
    } as unknown as WeeklyPlan;
    const insights = computeInsights({ log: [], history: [], plan, now: NOW });
    expect(insights.byCategory.cardio).toEqual({ done: 0, total: 1 });
  });
});

describe("agent workout assembly", () => {
  const filter = filterFromProfile(profile);
  const spec = {
    date: WEEK,
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

  it("shrinks to the day's free time, or gives up when there's none", () => {
    const w = assembleWorkout({ ...spec, exerciseIds: ["goblet_squat"] }, { id: "w2", profile, filter, maxMinutes: 25 });
    expect(w?.durationMin).toBe(25);
    expect(assembleWorkout({ ...spec, exerciseIds: ["goblet_squat"] }, { id: "w3", profile, filter, maxMinutes: 5 })).toBeNull();
  });

  it("falls back to the deterministic builder when no picks are usable", () => {
    const w = assembleWorkout({ ...spec, exerciseIds: ["nope"] }, { id: "w4", profile, filter });
    expect(w?.exercises.length).toBeGreaterThan(0);
  });

  it("allows one workout per day", () => {
    const w = assembleWorkout({ ...spec, exerciseIds: ["goblet_squat"] }, { id: "a", profile, filter })!;
    const other = { ...w, id: "b" };
    expect(fitsDay(w, [], [other], NOW)).toBe(false);
    expect(fitsDay(w, [], [{ ...other, status: "skipped" }], NOW)).toBe(true);
  });
});

describe("collateral fixes", () => {
  it("moves or shortens workouts the message knocks out, and says so", () => {
    const { busy, knownRange } = calendarForWeek("open", WEEK);
    const plan = buildSamplePlan({ profile, preset: "open", now: NOW, createdAt: "x" });
    const [first, second] = plan.workouts;
    const req = { profile, now: NOW } as AgentRequest;
    const ctx = { profile, busy, knownRange, now: NOW, previousPlan: plan, dateLimits: { [second.date]: 0 } };
    const { operations, notes } = resolveCollateral(plan, [{ op: "skip", workoutId: first.id }], ctx, req);
    expect(operations.length).toBe(2);
    expect(notes[0]).toMatch(second.title);
    // Before the fix the plan breaks the day limit; after it, everything passes.
    expect(validatePlan(applyOperations(plan, [{ op: "skip", workoutId: first.id }]), ctx).ok).toBe(false);
    expect(validatePlan(applyOperations(plan, operations), ctx).ok).toBe(true);
  });
});
