import { describe, expect, it } from "vitest";
import type { BusyBlock, FitnessProfile, WeeklyPlan, Workout } from "./schemas";
import { validatePlan, type ValidationContext } from "./validation";

const profile: FitnessProfile = {
  version: 1,
  goals: ["strength"],
  targetMuscles: [],
  experience: "intermediate",
  workoutTypes: ["gym", "running"],
  equipment: ["dumbbells"],
  sessionMinutes: 45,
  frequencyPerWeek: 3,
  preferredDays: ["mon", "wed", "fri"],
  preferredTimes: ["evening"],
  avoidTags: ["high_impact"],
  avoidExerciseIds: ["db_curl"],
  avoidNotes: "",
  limitations: "",
  updatedAt: "2026-11-01T00:00:00Z",
};

const workout = (over: Partial<Workout> = {}): Workout => ({
  id: "w1",
  title: "Lower body",
  date: "2026-11-02",
  start: "18:00",
  durationMin: 30,
  category: "strength",
  muscles: ["legs"],
  equipment: ["dumbbells"],
  exercises: [
    { exerciseId: "goblet_squat", sets: 3, reps: "8–12" },
    { exerciseId: "db_rdl", sets: 3, reps: "8–10" },
  ],
  rationale: "test",
  status: "planned",
  origin: "mock_template",
  ...over,
});

const plan = (workouts: Workout[]): WeeklyPlan => ({
  id: "p",
  weekStart: "2026-11-02",
  workouts,
  generatedBy: "fixture",
  createdAt: "2026-11-01T00:00:00Z",
  notes: [],
});

const busy: BusyBlock[] = [
  { id: "b1", date: "2026-11-02", start: "19:00", end: "20:00", title: "Class", source: "simulated" },
];

const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  profile,
  busy,
  knownRange: { start: "2026-11-02", end: "2026-11-08" },
  ...over,
});

const constraintsOf = (p: unknown, c = ctx()) => validatePlan(p, c).violations.map((v) => v.constraint);

describe("validatePlan", () => {
  it("accepts a clean plan", () => {
    const r = validatePlan(plan([workout()]), ctx());
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("rejects malformed plans via the schema", () => {
    expect(new Set(constraintsOf({ id: "x" }))).toEqual(new Set(["schema"]));
  });

  it("flags unknown exercises", () => {
    expect(constraintsOf(plan([workout({ exercises: [{ exerciseId: "made_up_move" }] })]))).toContain("catalog_grounded");
  });

  it("flags calendar conflicts and overlapping workouts", () => {
    expect(constraintsOf(plan([workout({ start: "18:45" })]))).toContain("calendar_conflict");
    const overlapping = plan([workout(), workout({ id: "w2", start: "18:15", date: "2026-11-02" })]);
    expect(constraintsOf(overlapping)).toContain("calendar_conflict");
  });

  it("ignores conflicts for completed and skipped workouts", () => {
    expect(constraintsOf(plan([workout({ start: "18:45", status: "skipped" })]))).not.toContain("calendar_conflict");
  });

  it("enforces session length, per-date limits, and realistic exercise volume", () => {
    expect(constraintsOf(plan([workout({ durationMin: 60 })]))).toContain("duration_limit");
    expect(constraintsOf(plan([workout()]), ctx({ dateLimits: { "2026-11-02": 20 } }))).toContain("duration_limit");
    expect(constraintsOf(plan([workout()]), ctx({ dateLimits: { "2026-11-02": 0 } }))).toContain("duration_limit");
    const crammed = workout({
      durationMin: 10,
      exercises: [{ exerciseId: "goblet_squat" }, { exerciseId: "db_rdl" }, { exerciseId: "db_row" }],
    });
    expect(constraintsOf(plan([crammed]))).toContain("duration_limit");
  });

  it("checks equipment, including overrides", () => {
    const barbell = workout({ exercises: [{ exerciseId: "deadlift" }], equipment: ["barbell"] });
    expect(constraintsOf(plan([barbell]))).toContain("equipment");
    expect(constraintsOf(plan([workout()]), ctx({ equipmentAvailable: [] }))).toContain("equipment");
  });

  it("checks avoided tags, avoided exercises, and extra restrictions", () => {
    expect(constraintsOf(plan([workout({ exercises: [{ exerciseId: "squat_jump" }] })]))).toContain("avoided_activity");
    expect(constraintsOf(plan([workout({ exercises: [{ exerciseId: "db_curl" }] })]))).toContain("avoided_activity");
    const press = workout({ exercises: [{ exerciseId: "db_shoulder_press" }] });
    expect(constraintsOf(plan([press]))).not.toContain("avoided_activity");
    expect(constraintsOf(plan([press]), ctx({ extraAvoidTags: ["overhead"] }))).toContain("avoided_activity");
  });

  it("requires completed workouts to be preserved exactly", () => {
    const done = workout({ status: "completed" });
    const previousPlan = plan([done]);
    expect(constraintsOf(plan([{ ...done, start: "07:00" }]), ctx({ previousPlan }))).toContain("completed_preserved");
    expect(constraintsOf(plan([]), ctx({ previousPlan }))).toContain("completed_preserved");
    expect(constraintsOf(plan([done]), ctx({ previousPlan }))).not.toContain("completed_preserved");
  });

  it("only allows known, waking-hours availability", () => {
    expect(constraintsOf(plan([workout({ date: "2026-11-12" })]))).toContain("grounded_availability");
    expect(constraintsOf(plan([workout({ start: "05:00" })]))).toContain("grounded_availability");
    expect(constraintsOf(plan([workout({ start: "21:45" })]))).toContain("grounded_availability");
  });

  it("blocks make-up overload", () => {
    const four = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map((date, i) =>
      workout({ id: `w${i}`, date }),
    );
    expect(constraintsOf(plan(four))).toContain("no_volume_spike");
    const stacked = plan([workout(), workout({ id: "w2", start: "07:00" })]);
    expect(constraintsOf(stacked)).toContain("no_volume_spike");
    const extraSets = workout({ exercises: [{ exerciseId: "goblet_squat", sets: 6 }] });
    expect(constraintsOf(plan([extraSets]))).toContain("no_volume_spike");
  });

  it("blocks scheduling changes into the past", () => {
    const previousPlan = plan([workout({ date: "2026-11-04" })]);
    const now = { date: "2026-11-03", time: "12:00" };
    expect(constraintsOf(plan([workout({ date: "2026-11-02" })]), ctx({ previousPlan, now }))).toContain(
      "no_past_scheduling",
    );
    expect(constraintsOf(plan([workout({ date: "2026-11-04" })]), ctx({ previousPlan, now }))).not.toContain(
      "no_past_scheduling",
    );
  });

  it("reports soft preferences as warnings, not violations", () => {
    const r = validatePlan(plan([workout({ date: "2026-11-03", start: "07:00" })]), ctx());
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.constraint)).toEqual(expect.arrayContaining(["preferred_day", "preferred_time"]));
  });
});
