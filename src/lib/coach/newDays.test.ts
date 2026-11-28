import { describe, expect, it } from "vitest";
import type { FitnessProfile } from "../schemas";
import { buildSamplePlan, calendarForWeek } from "../session";
import { validatePlan } from "../validation";
import { applyOperations } from "../planner/alternatives";
import { weekdayOf } from "../time";
import { parseNewDays, profileForAccepted, proposeForNewDays } from "./newDays";

const NOW = { date: "2026-11-27", time: "23:00" }; // a Friday night, like jf's report
const profile: FitnessProfile = {
  version: 1,
  goals: ["build_muscle"],
  targetMuscles: [],
  experience: "intermediate",
  workoutTypes: ["gym"],
  equipment: ["dumbbells", "bench"],
  sessionMinutes: 45,
  frequencyPerWeek: 3,
  preferredDays: ["mon", "fri", "sat"],
  preferredTimes: ["early_morning", "evening"],
  avoidTags: [],
  avoidExerciseIds: [],
  avoidNotes: "",
  limitations: "",
  updatedAt: "2026-11-01T00:00:00Z",
};

describe("a newly free day", () => {
  it("is read from the message, and not from a busy or negated one", () => {
    expect(parseNewDays("I can now do every wednesday also")).toEqual(["wed"]);
    expect(parseNewDays("I'm free on Tuesdays and Thursdays now")).toEqual(["tue", "thu"]);
    expect(parseNewDays("Wednesday works now")).toEqual(["wed"]);
    expect(parseNewDays("I can't do Wednesday anymore")).toEqual([]);
    expect(parseNewDays("I have a midterm on Wednesday")).toEqual([]);
  });

  it("goes into the workout days and offers to use it, not to skip unrelated workouts", () => {
    const plan = buildSamplePlan({ profile, preset: "open", now: NOW, createdAt: "x", blocked: [] });
    const { busy, knownRange } = calendarForWeek("open", plan.weekStart, []);
    const r = proposeForNewDays({
      plan,
      profile,
      days: parseNewDays("I can now do every wednesday also"),
      ctx: { busy, knownRange, now: NOW, previousPlan: plan },
      today: NOW.date,
      message: "I can now do every wednesday also",
      id: "p1",
      createdAt: "2026-11-28T06:00:00Z",
    });
    expect(r.profile.preferredDays).toEqual(["mon", "wed", "fri", "sat"]);
    expect(r.added).toEqual(["wed"]);
    expect(r.proposal.understood[0]).toMatch(/Added Wednesdays to your workout days/);
    // Nothing is skipped; every option puts a workout on a Wednesday.
    expect(r.proposal.alternatives.length).toBeGreaterThan(0);
    for (const alt of r.proposal.alternatives) {
      expect(alt.operations.every((o) => o.op !== "skip")).toBe(true);
      const next = applyOperations(plan, alt.operations);
      expect(next.workouts.some((w) => weekdayOf(w.date) === "wed" && w.status === "planned")).toBe(true);
      // Valid against the updated days (and, for an added workout, the raised weekly target), with locked preferences.
      const v = validatePlan(next, { profile: profileForAccepted(alt, r.profile), busy, knownRange, now: NOW, previousPlan: plan, lockPreferences: true });
      expect(v.violations).toEqual([]);
    }
    // The Sunday workout (Sunday wasn't one of the user's days) moves to Wednesday, or a workout is added there.
    const titles = r.proposal.alternatives.map((a) => a.title);
    expect(titles[0]).toBe("Move Full body strength to Wednesday");
    expect(titles[1]).toMatch(/^Add .+ on Wednesday$/);
    const add = r.proposal.alternatives[1];
    expect(profileForAccepted(add, r.profile).frequencyPerWeek).toBe(4);
    expect(profileForAccepted(r.proposal.alternatives[0], r.profile).frequencyPerWeek).toBe(3);
  });
});
