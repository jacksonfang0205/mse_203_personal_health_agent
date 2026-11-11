import { describe, expect, it } from "vitest";
import { DEMO_PROFILE } from "./demo";
import { FitnessProfile } from "./schemas";
import { buildSamplePlan, calendarForWeek } from "./session";
import { validatePlan } from "./validation";

describe("demo mode", () => {
  it("starts from a valid profile and a week that passes every check", () => {
    const profile = FitnessProfile.parse({ ...DEMO_PROFILE, updatedAt: "2026-11-11T08:00:00.000Z" });
    const now = { date: "2026-11-09", time: "07:00" };
    const plan = buildSamplePlan({ profile, preset: "student", now, createdAt: "2026-11-09T07:00:00.000Z" });
    expect(plan.workouts.length).toBe(profile.frequencyPerWeek);
    const { busy, knownRange } = calendarForWeek("student", now.date);
    expect(validatePlan(plan, { profile, busy, knownRange, now }).ok).toBe(true);
  });
});
