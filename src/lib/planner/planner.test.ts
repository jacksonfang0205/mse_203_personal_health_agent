import { describe, expect, it } from "vitest";
import { CALENDAR_PRESET_IDS, presetProvider } from "../calendar";
import { EXERCISES } from "../catalog";
import { Exercise, type FitnessProfile } from "../schemas";
import { validatePlan } from "../validation";
import { applyOperations, proposeRuleBasedAlternatives } from "./alternatives";
import { generateMockWeek } from "./generate";

const WEEK = "2026-11-02";

const base: FitnessProfile = {
  version: 1,
  goals: ["strength", "endurance"],
  targetMuscles: [],
  experience: "intermediate",
  workoutTypes: ["gym", "running", "yoga"],
  equipment: ["dumbbells", "barbell", "bench", "squat_rack", "cable_machine", "yoga_mat"],
  sessionMinutes: 45,
  frequencyPerWeek: 4,
  preferredDays: ["mon", "tue", "thu", "sat"],
  preferredTimes: ["early_morning", "evening"],
  avoidTags: [],
  avoidExerciseIds: [],
  avoidNotes: "",
  limitations: "",
  updatedAt: "2026-11-01T00:00:00Z",
};

const VARIANTS: FitnessProfile[] = [
  base,
  { ...base, experience: "beginner", equipment: [], workoutTypes: ["home", "walking"], sessionMinutes: 20, frequencyPerWeek: 5 },
  { ...base, goals: ["mobility"], workoutTypes: ["pilates", "yoga"], avoidTags: ["floor_work", "high_impact"], equipment: [] },
  { ...base, preferredDays: ["sun"], preferredTimes: ["midday"], frequencyPerWeek: 3 },
  { ...base, avoidTags: ["running", "heavy_barbell", "overhead"], targetMuscles: ["glutes", "core"] },
];

describe("exercise catalog", () => {
  it("has valid, unique entries", () => {
    for (const e of EXERCISES) expect(() => Exercise.parse(e)).not.toThrow();
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
  });
});

describe("generateMockWeek", () => {
  for (const preset of CALENDAR_PRESET_IDS) {
    VARIANTS.forEach((profile, i) => {
      it(`produces a valid plan (${preset}, variant ${i})`, () => {
        const cal = presetProvider(preset, WEEK);
        const busy = cal.getBusySync(cal.knownRange());
        const plan = generateMockWeek({ profile, weekStart: WEEK, busy, createdAt: "x" });
        const r = validatePlan(plan, { profile, busy, knownRange: cal.knownRange() });
        expect(r.violations).toEqual([]);
        expect(plan.workouts.length).toBeLessThanOrEqual(profile.frequencyPerWeek);
        if (plan.workouts.length < profile.frequencyPerWeek) expect(plan.notes.length).toBeGreaterThan(0);
      });
    });
  }

  it("never schedules before now and keeps carried-over workouts", () => {
    const cal = presetProvider("student", WEEK);
    const busy = cal.getBusySync(cal.knownRange());
    const first = generateMockWeek({ profile: base, weekStart: WEEK, busy, createdAt: "x" });
    const done = { ...first.workouts[0], status: "completed" as const };
    const now = { date: "2026-11-04", time: "12:00" };
    const plan = generateMockWeek({ profile: base, weekStart: WEEK, busy, now, keep: [done], createdAt: "x" });
    expect(plan.workouts).toContainEqual(done);
    for (const w of plan.workouts.filter((w) => w.status === "planned")) expect(w.date >= now.date).toBe(true);
    expect(validatePlan(plan, { profile: base, busy, knownRange: cal.knownRange(), now }).ok).toBe(true);
  });
});

describe("rule-based alternatives", () => {
  it("offers at most three options, each passing validation", () => {
    for (const preset of CALENDAR_PRESET_IDS) {
      VARIANTS.forEach((profile) => {
        const cal = presetProvider(preset, WEEK);
        const busy = cal.getBusySync(cal.knownRange());
        const plan = generateMockWeek({ profile, weekStart: WEEK, busy, createdAt: "x" });
        const now = { date: "2026-11-03", time: "09:00" };
        const proposal = proposeRuleBasedAlternatives({
          plan,
          profile,
          busy,
          knownRange: cal.knownRange(),
          now,
          userMessage: "test",
          proposalId: "p",
          createdAt: "x",
        });
        expect(proposal.alternatives.length).toBeLessThanOrEqual(3);
        for (const alt of proposal.alternatives) {
          const next = applyOperations(plan, alt.operations);
          const r = validatePlan(next, { profile, busy, knownRange: cal.knownRange(), now, previousPlan: plan });
          expect(r.violations).toEqual([]);
          expect(alt.tradeoffs.length).toBeGreaterThan(0);
        }
      });
    }
  });

  it("reports when nothing is left to adjust", () => {
    const cal = presetProvider("open", WEEK);
    const plan = generateMockWeek({ profile: base, weekStart: WEEK, busy: [], createdAt: "x" });
    const proposal = proposeRuleBasedAlternatives({
      plan,
      profile: base,
      busy: [],
      knownRange: cal.knownRange(),
      now: { date: "2026-11-09", time: "09:00" },
      userMessage: "test",
      proposalId: "p",
      createdAt: "x",
    });
    expect(proposal.alternatives).toEqual([]);
    expect(proposal.infeasibleReason).toBeTruthy();
  });

  it("applyOperations moves, replaces, skips, and adds", () => {
    const plan = generateMockWeek({ profile: base, weekStart: WEEK, busy: [], createdAt: "x" });
    const [a, b] = plan.workouts;
    const moved = applyOperations(plan, [{ op: "move", workoutId: a.id, date: "2026-11-08" }]);
    expect(moved.workouts.find((w) => w.id === a.id)).toMatchObject({ date: "2026-11-08" });
    expect(moved.workouts.at(-1)?.id).toBe(a.id); // re-sorted chronologically
    const skipped = applyOperations(plan, [{ op: "skip", workoutId: b.id }]);
    expect(skipped.workouts.find((w) => w.id === b.id)?.status).toBe("skipped");
    const replaced = applyOperations(plan, [{ op: "replace", workoutId: a.id, workout: { ...b, id: "other" } }]);
    expect(replaced.workouts.filter((w) => w.id === a.id)).toHaveLength(1);
    const added = applyOperations(plan, [{ op: "add", workout: { ...b, id: "new" } }]);
    expect(added.workouts).toHaveLength(plan.workouts.length + 1);
    expect(plan.workouts.find((w) => w.id === a.id)?.date).toBe(a.date); // original untouched
  });
});
