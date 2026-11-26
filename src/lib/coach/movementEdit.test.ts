import { describe, expect, it } from "vitest";
import { agentLifeHappens } from "../agent/lifeHappens";
import type { FitnessProfile, WeeklyPlan } from "../schemas";
import { buildSamplePlan } from "../session";
import { movementsIn, parseMovementEdit, targetWorkout } from "./movementEdit";

const WEEK = "2026-11-02"; // a Monday
const NOW = { date: WEEK, time: "06:00" };
const profile: FitnessProfile = {
  version: 1,
  goals: ["build_muscle"],
  targetMuscles: [],
  experience: "intermediate",
  workoutTypes: ["gym"],
  equipment: ["dumbbells", "bench"],
  sessionMinutes: 45,
  frequencyPerWeek: 3,
  preferredDays: ["mon", "wed", "fri"],
  preferredTimes: ["early_morning", "evening"],
  avoidTags: [],
  avoidExerciseIds: [],
  avoidNotes: "",
  limitations: "",
  updatedAt: "2026-11-01T00:00:00Z",
};

const plan = (): WeeklyPlan => buildSamplePlan({ profile, preset: "open", now: NOW, createdAt: "x", blocked: [] });
const request = (message: string, p = plan()) => ({
  profile,
  plan: p,
  history: [],
  blocked: [],
  notes: [],
  log: [],
  calendarPreset: "open" as const,
  now: NOW,
  message,
});

describe("movement requests", () => {
  it("finds movements by name and shorthand, longest name first", () => {
    expect(movementsIn("add a set of barbell bench press").map((e) => e.id)).toEqual(["bench_press"]);
    expect(movementsIn("swap goblet squats for RDLs").map((e) => e.id)).toEqual(["goblet_squat", "db_rdl"]);
    expect(movementsIn("add dumbbell bench press").map((e) => e.id)).toEqual(["db_bench"]);
  });

  it("reads add, remove and swap", () => {
    expect(parseMovementEdit("can you add a set of barbell bench press")).toMatchObject({ kind: "add", add: { id: "bench_press" }, sets: 1 });
    expect(parseMovementEdit("drop the goblet squats on Friday")).toMatchObject({ kind: "remove", remove: { id: "goblet_squat" } });
    expect(parseMovementEdit("replace goblet squat with leg press")).toMatchObject({ kind: "swap", remove: { id: "goblet_squat" }, add: { id: "leg_press" } });
    expect(parseMovementEdit("I have a midterm on Wednesday")).toBeNull();
  });

  it("targets the day named in the message, else today's workout", () => {
    const p = plan();
    const first = p.workouts.filter((w) => w.status === "planned").sort((a, b) => a.date.localeCompare(b.date))[0];
    expect(targetWorkout("add bench press", p, NOW.date)?.id).toBe(first.id);
    const fri = p.workouts.find((w) => w.date === "2026-11-06");
    if (fri) expect(targetWorkout("add bench press on Friday", p, NOW.date)?.id).toBe(fri.id);
  });

  it("adds bench press to a lower-body day without turning it into an upper-body day", async () => {
    // jf's report: on a lower body strength day, "add a set of barbell bench press" rewrote the day as upper body.
    const p = plan();
    const lower = p.workouts.find((w) => /lower/i.test(w.title)) ?? p.workouts[0];
    const day = new Date(`${lower.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    // No AI key in tests: this must be answered without the model.
    const res = await agentLifeHappens(request(`On ${day}, add a set of barbell bench press`, p));
    expect(res.usage).toEqual([]);
    const alt = res.proposal.alternatives[0];
    expect(alt.title).toBe("Add Barbell bench press");
    const op = alt.operations[0];
    expect(op.op).toBe("replace");
    if (op.op !== "replace") return;
    expect(op.workoutId).toBe(lower.id);
    expect(op.workout.title).toBe(lower.title);
    expect(op.workout.date).toBe(lower.date);
    expect(op.workout.start).toBe(lower.start);
    expect(op.workout.exercises.map((e) => e.exerciseId)).toEqual([...lower.exercises.map((e) => e.exerciseId), "bench_press"]);
    // Honest about the barbell this user doesn't have.
    expect(alt.tradeoffs.join(" ")).toMatch(/barbell/i);
    // No other workout changes.
    expect(alt.operations).toHaveLength(1);
  });

  it("adds sets to a movement that's already there", async () => {
    const p = plan();
    const w = p.workouts[0];
    const we = w.exercises.find((e) => e.sets)!;
    const name = (await import("../catalog")).getExercise(we.exerciseId)!.name;
    const res = await agentLifeHappens(request(`add 2 more sets of ${name}`, p));
    const op = res.proposal.alternatives[0].operations[0];
    if (op.op !== "replace") throw new Error("expected replace");
    expect(op.workout.exercises.find((e) => e.exerciseId === we.exerciseId)?.sets).toBe((we.sets ?? 1) + 2);
    expect(op.workout.exercises).toHaveLength(w.exercises.length);
  });

  it("says so when removing a movement that isn't in the workout", async () => {
    const res = await agentLifeHappens(request("remove the barbell bench press"));
    expect(res.proposal.alternatives).toEqual([]);
    expect(res.proposal.infeasibleReason).toMatch(/isn't in your/);
  });
});
