import { describe, expect, it } from "vitest";
import type { BlockedTime, FitnessProfile } from "../schemas";
import { buildSamplePlan, calendarForWeek } from "../session";
import { validatePlan } from "../validation";
import { clashesWithBusy, findClashes, resolveClashes } from "./clashes";

// Regression for 2026-11-11: a workout planned at 2 pm on Wednesday, built before the user imported
// Google Calendar busy times that include a 1:30-2:50 pm class.
const profile: FitnessProfile = {
  version: 1,
  goals: ["strength"],
  targetMuscles: [],
  experience: "intermediate",
  workoutTypes: ["gym"],
  equipment: ["dumbbells", "barbell", "bench", "squat_rack", "cable_machine", "pull_up_bar"],
  sessionMinutes: 60,
  frequencyPerWeek: 3,
  preferredDays: ["wed", "fri", "sun"],
  preferredTimes: ["afternoon", "evening"],
  avoidTags: [],
  avoidExerciseIds: [],
  avoidNotes: "",
  limitations: "",
  updatedAt: "2026-11-11T18:00:00.000Z",
};
const now = { date: "2026-11-11", time: "10:00" };
const imported: BlockedTime[] = [
  ["2026-11-11", "13:30", "14:50"],
  ["2026-11-11", "15:00", "16:20"],
  ["2026-11-11", "15:30", "18:20"],
  ["2026-11-12", "13:30", "14:50"],
].map(([date, start, end], i) => ({
  id: `gcal-e${i}-${date}`,
  days: [date === "2026-11-11" ? "wed" : "thu"],
  date,
  start,
  end,
  label: "Google Calendar",
  source: "user",
  createdAt: "2026-11-11T18:00:00.000Z",
}));

describe("imported calendar times", () => {
  it("are avoided by a plan built after the import", () => {
    const plan = buildSamplePlan({ profile, preset: "student", now, createdAt: "x", blocked: imported });
    const { busy } = calendarForWeek("student", now.date, imported);
    expect(findClashes(plan, busy, now)).toEqual([]);
  });

  it("move a workout planned before the import out of the clash", () => {
    const before = buildSamplePlan({ profile, preset: "student", now, createdAt: "x" });
    // Put Wednesday's session at 2 pm, as in the bug report.
    const plan = {
      ...before,
      workouts: before.workouts.map((w, i) => (i === 0 ? { ...w, date: "2026-11-11", start: "14:00" } : w)),
    };
    const { busy, knownRange } = calendarForWeek("student", now.date, imported);
    expect(findClashes(plan, busy, now).map((w) => w.start)).toEqual(["14:00"]);

    const res = resolveClashes({ plan, profile, busy, now });
    expect(res.moved).toHaveLength(1);
    expect(res.unresolved).toEqual([]);
    for (const w of res.plan.workouts) expect(clashesWithBusy(w, busy), `${w.date} ${w.start}`).toBe(false);
    expect(validatePlan(res.plan, { profile, busy, knownRange, now }).violations.filter((v) => v.constraint === "calendar_conflict")).toEqual([]);
  });
});
