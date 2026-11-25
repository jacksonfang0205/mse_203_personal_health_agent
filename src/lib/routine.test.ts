import { describe, expect, it } from "vitest";
import { ALL_EXERCISES, EXERCISES, getExercise } from "./catalog";
import {
  defaultEntry,
  planFromRoutine,
  profileForRoutine,
  searchMovements,
  suggestTitle,
  withExercises,
} from "./routine";
import { Exercise, FitnessProfile, Routine, WeeklyPlan, type Workout } from "./schemas";
import { validatePlan } from "./validation";

const WEEK = "2026-11-02"; // a Monday

const profile: FitnessProfile = {
  version: 1,
  goals: ["strength"],
  targetMuscles: [],
  experience: "intermediate",
  workoutTypes: ["gym"],
  equipment: ["dumbbells", "bench"],
  sessionMinutes: 45,
  frequencyPerWeek: 3,
  preferredDays: ["mon", "wed", "fri"],
  preferredTimes: ["evening"],
  avoidTags: ["heavy_barbell"],
  avoidExerciseIds: ["back_squat"],
  avoidNotes: "",
  limitations: "",
  updatedAt: "2026-11-01T00:00:00Z",
};

const routine: Routine = Routine.parse({
  updatedAt: "2026-11-01T00:00:00Z",
  days: [
    { day: "mon", title: "Legs", start: "18:00", exercises: [defaultEntry(getExercise("leg_press")!), defaultEntry(getExercise("back_squat")!)] },
    { day: "thu", title: "Push", start: "07:00", exercises: [defaultEntry(getExercise("db_bench")!), defaultEntry(getExercise("tricep_pushdown")!)] },
  ],
});

describe("movement catalog", () => {
  it("has valid, unique entries, and the planner's list is unchanged by the extras", () => {
    for (const e of ALL_EXERCISES) expect(() => Exercise.parse(e)).not.toThrow();
    expect(new Set(ALL_EXERCISES.map((e) => e.id)).size).toBe(ALL_EXERCISES.length);
    expect(EXERCISES.some((e) => e.id === "leg_press")).toBe(false);
    expect(getExercise("leg_press")?.name).toBe("Leg press");
  });
});

describe("searchMovements", () => {
  const all = { query: "", category: "all", muscle: "all" } as const;

  it("matches every word against name, muscles and equipment", () => {
    const names = searchMovements({ ...all, query: "dumbbell press" }).map((e) => e.name);
    expect(names).toContain("Dumbbell bench press");
    expect(names).toContain("Dumbbell shoulder press");
    expect(names).not.toContain("Leg press");
    expect(searchMovements({ ...all, query: "glutes" }).every((e) => e.muscles.includes("glutes"))).toBe(true);
  });

  it("puts name matches first", () => {
    expect(searchMovements({ ...all, query: "squat" })[0].name.toLowerCase()).toContain("squat");
  });

  it("filters by category and muscle", () => {
    const yoga = searchMovements({ ...all, category: "yoga" });
    expect(yoga.length).toBeGreaterThan(0);
    expect(yoga.every((e) => e.category === "yoga")).toBe(true);
    const chest = searchMovements({ ...all, category: "strength", muscle: "chest" });
    expect(chest.every((e) => e.category === "strength" && e.muscles.includes("chest"))).toBe(true);
  });

  it("ignores case and punctuation", () => {
    expect(searchMovements({ ...all, query: "PULL UP" }).map((e) => e.id)).toContain("pull_up");
    expect(searchMovements({ ...all, query: "worlds greatest" }).map((e) => e.id)).toContain("worlds_greatest_stretch");
    expect(searchMovements({ ...all, query: "RDL" }).map((e) => e.id)).toContain("db_rdl");
  });

  it("lists movements the user has the equipment for first, without hiding the rest", () => {
    const res = searchMovements({ ...all, query: "row" }, profile);
    expect(res[0].equipment.every((e) => profile.equipment.includes(e))).toBe(true);
    expect(res.map((e) => e.id)).toContain("cable_row");
  });
});

describe("withExercises", () => {
  const w: Workout = {
    id: "w1",
    title: "Upper body",
    date: WEEK,
    start: "18:00",
    durationMin: 45,
    category: "strength",
    muscles: ["chest"],
    equipment: ["dumbbells"],
    exercises: [defaultEntry(getExercise("db_bench")!)],
    rationale: "",
    status: "planned",
    origin: "agent",
  };

  it("keeps the slot when the movements fit, and marks the workout as the user's", () => {
    const next = withExercises(w, [defaultEntry(getExercise("leg_press")!)]);
    expect(next.durationMin).toBe(45);
    expect(next.origin).toBe("user");
    expect(next.muscles).toEqual(["legs", "glutes"]);
    expect(next.equipment).toEqual(["machines"]);
  });

  it("grows the slot when the movements don't fit", () => {
    const lots = ["back_squat", "deadlift", "bench_press", "overhead_press", "pull_up"].map((id) => defaultEntry(getExercise(id)!));
    const next = withExercises(w, lots);
    expect(next.durationMin).toBeGreaterThan(45);
    expect(next.durationMin % 5).toBe(0);
  });
});

describe("routines", () => {
  it("lays out the week from the routine's days", () => {
    const plan = WeeklyPlan.parse(planFromRoutine({ routine, weekStart: WEEK, createdAt: "2026-11-02T08:00:00Z" }));
    expect(plan.generatedBy).toBe("routine");
    expect(plan.workouts.map((w) => [w.date, w.title, w.start])).toEqual([
      ["2026-11-02", "Legs", "18:00"],
      ["2026-11-05", "Push", "07:00"],
    ]);
    expect(plan.workouts.every((w) => w.origin === "user" && w.status === "planned")).toBe(true);
  });

  it("keeps finished workouts instead of overwriting their day", () => {
    const first = planFromRoutine({ routine, weekStart: WEEK, createdAt: "a" });
    const done = { ...first.workouts[0], status: "completed" as const, title: "What I really did" };
    const plan = planFromRoutine({ routine, weekStart: WEEK, createdAt: "b", keep: [done] });
    expect(plan.workouts.filter((w) => w.date === WEEK)).toEqual([done]);
  });

  it("doesn't flag the user's own picks as equipment or avoidance problems", () => {
    const plan = planFromRoutine({ routine, weekStart: WEEK, createdAt: "a" });
    const res = validatePlan(plan, {
      profile,
      busy: [],
      knownRange: { start: WEEK, end: "2026-11-08" },
    });
    expect(res.violations.filter((v) => ["equipment", "avoided_activity"].includes(v.constraint))).toEqual([]);
  });

  it("still flags the same movements when Pivot chose them", () => {
    const plan = planFromRoutine({ routine, weekStart: WEEK, createdAt: "a" });
    const pivotPlan = { ...plan, workouts: plan.workouts.map((w) => ({ ...w, origin: "agent" as const })) };
    const res = validatePlan(pivotPlan, { profile, busy: [], knownRange: { start: WEEK, end: "2026-11-08" } });
    expect(res.violations.some((v) => v.constraint === "equipment")).toBe(true);
    expect(res.violations.some((v) => v.constraint === "avoided_activity")).toBe(true);
  });

  it("derives preferences from the routine and keeps what the user already said", () => {
    const p = FitnessProfile.parse(profileForRoutine(routine, profile, "now"));
    expect(p.preferredDays).toEqual(["mon", "thu"]);
    expect(p.preferredTimes).toEqual(["evening", "early_morning"]);
    expect(p.frequencyPerWeek).toBe(2);
    expect(p.equipment).toEqual(expect.arrayContaining(["dumbbells", "bench", "machines", "barbell", "squat_rack", "cable_machine"]));
    expect(p.avoidExerciseIds).toEqual(["back_squat"]);
    const fresh = FitnessProfile.parse(profileForRoutine(routine, null, "now", "Sam"));
    expect(fresh.name).toBe("Sam");
    expect(fresh.goals).toEqual(["general_fitness"]);
  });

  it("names a day from its movements", () => {
    expect(suggestTitle([defaultEntry(getExercise("leg_press")!)])).toBe("Lower body");
    expect(suggestTitle([defaultEntry(getExercise("db_bench")!)])).toBe("Upper body");
    expect(suggestTitle([defaultEntry(getExercise("easy_run")!)])).toBe("Cardio");
    expect(suggestTitle(["goblet_squat", "db_rdl", "plank"].map((id) => defaultEntry(getExercise(id)!)))).toBe("Lower body");
    expect(suggestTitle(["goblet_squat", "db_bench"].map((id) => defaultEntry(getExercise(id)!)))).toBe("Full body");
  });
});
