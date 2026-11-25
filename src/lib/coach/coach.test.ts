/**
 * Coach feedback round 2: injuries reach the coach's memory, done items drop
 * out of the coach box, and preference-level requests are clarified over a
 * few questions and then changed proportionately (enforced in code).
 */
import { describe, expect, it } from "vitest";
import type { AgentRequest } from "../agent/context";
import { memoryContext, profileContext } from "../agent/context";
import { gate } from "../agent/lifeHappens";
import { getExercise } from "../catalog";
import { detectInjury, injuryMemoryNote } from "../injuries";
import { applyOperations } from "../planner/alternatives";
import { regionOf } from "../planner/focus";
import { generateMockWeek } from "../planner/generate";
import type { Alternative, BlockedTime, FitnessProfile, MemoryNote, WeeklyPlan, Workout } from "../schemas";
import { assessChange, isLowerBody, validatePlan, type ValidationContext } from "../validation";
import {
  buildPreferenceChange,
  memoryFor,
  needsClarification,
  nextQuestion,
  outOfScopeChanges,
  parsePreferenceRequest,
  preferenceScope,
  type ClarifyAnswers,
} from "./clarify";
import { stillActionable, unsavedMemory } from "./history";

const WEEK = "2026-11-23"; // Monday
const NOW = { date: WEEK, time: "07:00" };
const RANGE = { start: WEEK, end: "2026-11-29" };
const JF = "I want to maintain function and mobility in my lower body, but do not want to focus strength or growth";

const profile: FitnessProfile = {
  version: 1,
  goals: ["strength"],
  targetMuscles: [],
  experience: "intermediate",
  workoutTypes: ["home", "running"],
  equipment: ["dumbbells"],
  sessionMinutes: 45,
  frequencyPerWeek: 3,
  preferredDays: ["mon", "wed", "fri"],
  preferredTimes: ["evening"],
  avoidTags: [],
  avoidExerciseIds: [],
  avoidNotes: "",
  limitations: "",
  updatedAt: "2026-11-01T00:00:00Z",
};

const upper = (over: Partial<Workout> = {}): Workout => ({
  id: "w-wed",
  title: "Upper body strength",
  date: "2026-11-25",
  start: "18:00",
  durationMin: 45,
  category: "strength",
  muscles: ["back", "arms", "chest"],
  equipment: ["dumbbells"],
  exercises: [
    { exerciseId: "db_row", sets: 3, reps: "10 / side" },
    { exerciseId: "db_floor_press", sets: 3, reps: "10–12" },
    { exerciseId: "db_curl", sets: 3, reps: "10–12" },
  ],
  rationale: "test",
  status: "planned",
  origin: "agent",
  ...over,
});
const legs = (over: Partial<Workout> = {}): Workout =>
  upper({
    id: "w-mon",
    title: "Lower body strength",
    date: "2026-11-23",
    muscles: ["legs", "glutes", "core"],
    exercises: [
      { exerciseId: "goblet_squat", sets: 3, reps: "8–12" },
      { exerciseId: "db_rdl", sets: 3, reps: "8–10" },
      { exerciseId: "plank", sets: 3, seconds: 30 },
    ],
    ...over,
  });
const run = (over: Partial<Workout> = {}): Workout =>
  upper({ id: "w-fri", title: "Easy run", date: "2026-11-27", category: "cardio", muscles: ["legs", "full_body"], equipment: [], exercises: [{ exerciseId: "easy_run", minutes: 45 }], ...over });
const plan = (workouts: Workout[]): WeeklyPlan => ({ id: "p", weekStart: WEEK, workouts, generatedBy: "agent", createdAt: "x", notes: [] });
const ctx = (previousPlan: WeeklyPlan): ValidationContext => ({ profile, busy: [], knownRange: RANGE, now: NOW, previousPlan });
const names = (w: Workout) => w.exercises.map((e) => e.exerciseId);

/** Answer every question with the given picks (or skip with the fallback). */
function answerAll(message: string, p: WeeklyPlan, picks: ClarifyAnswers = {}) {
  const flow = needsClarification(message, p, WEEK)!;
  const answers: ClarifyAnswers = {};
  const asked: string[] = [];
  let q = flow.next;
  while (q) {
    asked.push(q.id);
    answers[q.id] = picks[q.id] ?? q.fallback;
    q = nextQuestion(flow.request, answers, p, WEEK);
  }
  return { flow, answers, asked, change: buildPreferenceChange(flow.request, answers, p, profile, WEEK) };
}

describe("1. injuries reach the coach's memory", () => {
  it("adds an injury note once, and the coach and planner context include it", () => {
    const injury = detectInjury("my shin has been hurting")!;
    const note = injuryMemoryNote(injury, [], WEEK)!;
    expect(note.text).toBe("Injury: shin pain. Avoid running and jumping & high impact (told the coach Mon, Nov 23).");
    expect(injuryMemoryNote(injury, [note], "2026-11-24")).toBeNull(); // no duplicate
    const req = { profile, plan: null, history: [], blocked: [], notes: [note], log: [], calendarPreset: "open", now: NOW } as AgentRequest;
    expect(memoryContext(req).notes).toContain(note.text);
  });

  it("the stated body focus reaches the AI's profile context", () => {
    expect(profileContext({ ...profile, bodyFocus: { lower: "mobility" } }).body_focus).toEqual(["Lower-body: mobility & function, not strength/growth"]);
  });
});

describe("5. done items drop out of the coach box", () => {
  const alt = (workoutId: string): Alternative => ({ id: "a", kind: "skip", title: "Rest", summary: "", tradeoffs: [], operations: [{ op: "skip", workoutId }] });
  it("hides options for workouts already completed, skipped or past", () => {
    const p = plan([legs({ status: "completed" }), upper(), run({ status: "skipped" }), upper({ id: "w-old", date: "2026-11-20" })]);
    expect(stillActionable(alt("w-wed"), p, WEEK)).toBe(true);
    expect(stillActionable(alt("w-mon"), p, WEEK)).toBe(false);
    expect(stillActionable(alt("w-fri"), p, WEEK)).toBe(false);
    expect(stillActionable(alt("w-old"), p, WEEK)).toBe(false);
    expect(stillActionable(alt("gone"), p, WEEK)).toBe(false);
  });

  it("hides 'Remember:' suggestions that are already saved", () => {
    const b: BlockedTime = { id: "1", days: ["tue"], start: "18:00", end: "20:00", label: "Lab", source: "agent", createdAt: "x" };
    const n: MemoryNote = { id: "2", text: "Prefers evenings.", source: "agent", createdAt: "x" };
    expect(unsavedMemory({ blocked: [{ ...b, id: "9" }], notes: [{ ...n, id: "8", text: "prefers evenings" }] }, { blocked: [b], notes: [n] })).toBeNull();
    expect(unsavedMemory({ blocked: [{ ...b, days: ["wed"] }], notes: [] }, { blocked: [b], notes: [n] })?.blocked).toHaveLength(1);
  });
});

describe("6. collaborative clarifying", () => {
  it("reads preference-level requests, including body-focus shifts", () => {
    expect(parsePreferenceRequest(JF)).toMatchObject({ kind: "emphasis", region: "lower", emphasis: "mobility", notStrength: true });
    expect(parsePreferenceRequest("move from upper body to lower body")).toMatchObject({ kind: "shift", from: "upper", region: "lower" });
    expect(parsePreferenceRequest("I want more lower body and less upper body")).toMatchObject({ kind: "shift", from: "upper", region: "lower" });
    expect(parsePreferenceRequest("shift my focus from lower body to upper body")).toMatchObject({ kind: "shift", from: "lower", region: "upper" });
    expect(parsePreferenceRequest("I want stronger legs")).toMatchObject({ kind: "emphasis", region: "lower", emphasis: "strength" });
    // Specific requests go straight through.
    expect(parsePreferenceRequest("swap Wednesday's workout for lower-body mobility")).toBeNull();
    expect(parsePreferenceRequest("I only have 20 minutes today")).toBeNull();
    expect(parsePreferenceRequest("I have a midterm Friday")).toBeNull();
  });

  it("asks 2–3 questions, each shaped by the answer before it", () => {
    const p = plan([legs(), upper(), run()]);
    const { asked } = answerAll(JF, p);
    expect(asked).toEqual(["how", "days", "trim"]);
    // Picking "a whole day" asks which single day, and no trim question.
    expect(answerAll(JF, p, { how: "day" }).asked).toEqual(["how", "days"]);
    // "Just remember it" ends the questions and changes nothing.
    const remember = answerAll(JF, p, { how: "remember" });
    expect(remember.asked).toEqual(["how"]);
    expect(remember.change.operations).toEqual([]);
    expect(remember.change.memory).toBe("Lower-body: mobility & function, not strength/hypertrophy.");
    expect(remember.change.bodyFocus).toEqual({ lower: "mobility" });
  });

  it("jf's example: no lower-body day, so it adds a mobility block to a day and never wipes the upper-body work", () => {
    const p = plan([upper(), run()]);
    const flow = needsClarification(JF, p, WEEK)!;
    expect(flow.next!.choices.map((c) => c.value)).toEqual(["block", "day", "remember"]); // no lower strength to swap
    const { change } = answerAll(JF, p);
    expect(change.operations).toHaveLength(1);
    const op = change.operations[0];
    if (op.op !== "replace") throw new Error("expected replace");
    const w = op.workout;
    expect([w.date, w.start, w.durationMin, w.category]).toEqual(["2026-11-25", "18:00", 45, "strength"]);
    expect(names(w).slice(0, 3)).toEqual(["db_row", "db_floor_press", "db_curl"]); // upper work kept
    const added = names(w).slice(3).map((id) => getExercise(id)!);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((e) => ["mobility", "yoga"].includes(e.category) && regionOf(e) === "lower")).toBe(true);
    const next = applyOperations(p, change.operations);
    expect(outOfScopeChanges(p, next, change.scope)).toEqual([]);
    expect(assessChange(next, ctx(p)).status).toBe("fits");
  });

  it("'swap' replaces only lower-body strength moves on lower days", () => {
    const p = plan([legs(), upper(), run()]);
    const { change } = answerAll(JF, p, { how: "swap", days: "all" });
    expect(change.scope).toEqual(["w-mon"]);
    const op = change.operations[0];
    if (op.op !== "replace") throw new Error("expected replace");
    expect(names(op.workout)).not.toContain("goblet_squat");
    expect(names(op.workout)).not.toContain("db_rdl");
    expect(names(op.workout)).toContain("plank"); // core move untouched
    const next = applyOperations(p, change.operations);
    expect(next.workouts.find((w) => w.id === "w-wed")).toEqual(p.workouts.find((w) => w.id === "w-wed"));
    expect(validatePlan(next, ctx(p)).ok).toBe(true);
  });

  it("a body-focus shift turns the chosen upper day into lower body, keeping slot and spacing", () => {
    const p = plan([upper(), run()]);
    const { asked, change } = answerAll("move from upper body to lower body", p);
    expect(asked).toEqual(["days", "style"]);
    const op = change.operations[0];
    if (op.op !== "replace") throw new Error("expected replace");
    expect(isLowerBody(op.workout)).toBe(true);
    expect([op.workout.date, op.workout.start, op.workout.durationMin]).toEqual(["2026-11-25", "18:00", 45]);
    expect(change.bodyFocus).toEqual({ lower: "strength", upper: "less" });
    // Next to an existing leg day, a strength shift becomes mobility instead of back-to-back legs.
    const tight = plan([legs({ date: "2026-11-24" }), upper(), run()]);
    const t = answerAll("move from upper body to lower body", tight).change.operations[0];
    if (t.op !== "replace") throw new Error("expected replace");
    expect(t.workout.category).toBe("mobility");
    expect(memoryFor(answerAll("move from upper body to lower body", p).flow.request, "strength")).toBe("Prefers lower-body focus over upper-body.");
  });
});

describe("6. proportionality is enforced in code", () => {
  it("flags any change to a workout outside the request's scope", () => {
    const p = plan([upper(), run()]);
    const wiped = applyOperations(p, [{ op: "replace", workoutId: "w-wed", workout: { ...upper(), title: "Lower-body mobility", category: "mobility", muscles: ["legs", "glutes"], exercises: [{ exerciseId: "hip_circles", sets: 2, reps: "8" }] } }]);
    const req = parsePreferenceRequest(JF)!;
    expect(preferenceScope(req, p)).toEqual([]);
    expect(outOfScopeChanges(p, wiped, preferenceScope(req, p)).map((w) => w.id)).toEqual(["w-wed"]);
  });

  it("the AI gate rejects jf's over-correction (an upper-body day rewritten as lower-body mobility)", () => {
    const p = plan([upper(), run()]);
    const req: AgentRequest = { profile, plan: p, history: [], blocked: [], notes: [], log: [], calendarPreset: "open", now: NOW, calendar: { busy: [], knownRange: RANGE } };
    const out = {
      alternatives: [
        { kind: "swap_format" as const, title: "Lower-body mobility day", summary: "x", tradeoffs: [], operations: [{ op: "replace" as const, workoutId: "w-wed", category: "mobility" as const, minutes: 45, focus: ["legs" as const, "glutes" as const], exerciseIds: ["hip_circles", "worlds_greatest_stretch", "standing_hamstring"], title: "Lower-body mobility" }] },
        { kind: "skip" as const, title: "Rest", summary: "x", tradeoffs: [], operations: [{ op: "skip" as const, workoutId: "w-fri" }] },
      ],
    };
    const scoped = gate(out, req, p, ctx(p), preferenceScope(parsePreferenceRequest(JF)!, p));
    expect(scoped.valid.map((a) => a.kind)).toEqual(["skip"]);
    expect(scoped.problems.join(" ")).toMatch(/isn't about/);
    // Without a preference-level message the same option is allowed through.
    expect(gate(out, req, p, ctx(p)).valid.map((a) => a.kind)).toContain("swap_format");
  });
});

describe("6. body regions", () => {
  it("classifies exercises by most of their muscles", () => {
    expect(regionOf(getExercise("deadlift")!)).toBe("lower");
    expect(regionOf(getExercise("db_row")!)).toBe("upper");
    expect(regionOf(getExercise("plank")!)).toBeNull();
  });
});

describe("6. future plans follow the stated body focus", () => {
  it("lower body: mobility swaps lower-body strength moves; upper: less drops upper-body days", () => {
    const legsFirst = { ...profile, workoutTypes: ["home"] as FitnessProfile["workoutTypes"] };
    const before = generateMockWeek({ profile: legsFirst, weekStart: WEEK, busy: [], now: NOW, createdAt: "x" });
    expect(before.workouts.some((w) => w.exercises.some((e) => getExercise(e.exerciseId)?.category === "strength" && regionOf(getExercise(e.exerciseId)!) === "lower"))).toBe(true);
    const mobile = generateMockWeek({ profile: { ...legsFirst, bodyFocus: { lower: "mobility" } }, weekStart: WEEK, busy: [], now: NOW, createdAt: "x" });
    for (const w of mobile.workouts) {
      for (const e of w.exercises) {
        const ex = getExercise(e.exerciseId)!;
        expect(ex.category === "strength" && regionOf(ex) === "lower").toBe(false);
      }
    }
    const lessUpper = generateMockWeek({ profile: { ...legsFirst, bodyFocus: { upper: "less" } }, weekStart: WEEK, busy: [], now: NOW, createdAt: "x" });
    expect(lessUpper.workouts.map((w) => w.title)).not.toContain("Upper body strength");
  });
});
