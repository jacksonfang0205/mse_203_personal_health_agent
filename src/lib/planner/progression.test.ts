import { describe, expect, it } from "vitest";
import type { FitnessProfile, WorkoutLogEntry } from "../schemas";
import { needsCaution, weeklyLoadBudget } from "./progression";

const WEEK = "2026-11-23";
const profile = (p: Partial<FitnessProfile> = {}) =>
  ({
    goals: ["general_fitness"],
    experience: "beginner",
    frequencyPerWeek: 3,
    sessionMinutes: 30,
    limitations: "",
    avoidNotes: "",
    ...p,
  }) as FitnessProfile;
const done = (date: string, durationMin: number): WorkoutLogEntry => ({
  workoutId: date,
  date,
  start: "07:00",
  durationMin,
  category: "cardio",
  status: "completed",
  at: `${date}T08:00:00Z`,
});

describe("weeklyLoadBudget", () => {
  it("starts a new beginner at half their target", () => {
    const b = weeklyLoadBudget({ profile: profile(), log: [], weekStart: WEEK });
    expect(b.status).toBe("new");
    expect(b.planMinutes).toBe(45);
    expect(b.sessions * b.sessionMinutes).toBeLessThanOrEqual(45);
  });

  it("starts more experienced new users higher, and lower with an injury", () => {
    const adv = weeklyLoadBudget({ profile: profile({ experience: "advanced", frequencyPerWeek: 4, sessionMinutes: 60 }), log: [], weekStart: WEEK });
    expect(adv.planMinutes).toBe(170); // 0.7 × 240
    const hurt = weeklyLoadBudget({ profile: profile({ experience: "advanced", frequencyPerWeek: 4, sessionMinutes: 60, limitations: "lower back strain" }), log: [], weekStart: WEEK });
    expect(hurt.planMinutes).toBeLessThan(adv.planMinutes);
  });

  it("lets an endurance user add about 10% a week, capped at their target", () => {
    const log = [done("2026-11-17", 30), done("2026-11-19", 30), done("2026-11-21", 30)];
    const b = weeklyLoadBudget({ profile: profile({ goals: ["endurance"], sessionMinutes: 45 }), log, weekStart: WEEK });
    expect(b.status).toBe("continuing");
    expect(b.baseline).toBe(90);
    expect(b.planMinutes).toBe(100); // 99 rounded to 5
    expect(b.capMinutes).toBe(100);
  });

  it("progresses strength by ~5% of minutes (load and sets carry the rest)", () => {
    const log = [done("2026-11-16", 60), done("2026-11-18", 60), done("2026-11-20", 60), done("2026-11-21", 60)];
    const b = weeklyLoadBudget({ profile: profile({ goals: ["strength"], frequencyPerWeek: 5, sessionMinutes: 60 }), log, weekStart: WEEK });
    expect(b.capMinutes).toBe(250); // 240 × 1.05 = 252 → 250
  });

  it("caps at the user's target when they already train that much, but allows one step for 'do more'", () => {
    const log = [done("2026-11-17", 45), done("2026-11-19", 45), done("2026-11-21", 45)];
    const b = weeklyLoadBudget({ profile: profile({ goals: ["endurance"], sessionMinutes: 45 }), log, weekStart: WEEK });
    expect(b.planMinutes).toBe(135);
    expect(b.capMinutes).toBe(150); // 148.5 → 150, nowhere near "double"
  });

  it("holds volume when something hurts", () => {
    const log = [done("2026-11-17", 40), done("2026-11-19", 40), done("2026-11-21", 40)];
    const b = weeklyLoadBudget({ profile: profile({ sessionMinutes: 40 }), log, weekStart: WEEK, message: "My knee's been kinda weird" });
    expect(b.capMinutes).toBe(120);
  });

  it("restarts at a fraction of the pre-break load after weeks off", () => {
    const log = [done("2026-10-02", 60), done("2026-10-05", 60), done("2026-10-07", 60), done("2026-10-09", 60)];
    const b = weeklyLoadBudget({ profile: profile({ frequencyPerWeek: 5, sessionMinutes: 60 }), log, weekStart: WEEK });
    expect(b.status).toBe("returning");
    expect(b.planMinutes).toBeLessThanOrEqual(0.7 * b.baseline!);
  });

  it("keeps the 4-week acute:chronic ratio at or below 1.3", () => {
    // One big week after three light ones: last week alone would allow more.
    const log = [done("2026-10-27", 20), done("2026-11-03", 20), done("2026-11-10", 20), done("2026-11-17", 120)];
    const b = weeklyLoadBudget({ profile: profile({ goals: ["endurance"], frequencyPerWeek: 5, sessionMinutes: 60 }), log, weekStart: WEEK });
    expect(b.capMinutes).toBeLessThanOrEqual(Math.round((180 / 4) * 1.3 / 5) * 5);
  });
});

describe("needsCaution", () => {
  it("spots pain or injury words and ignores plain text", () => {
    expect(needsCaution({ limitations: "shoulder impingement, it hurts overhead", avoidNotes: "" })).toBe(true);
    expect(needsCaution({ limitations: "", avoidNotes: "" }, "can't make Thursday")).toBe(false);
  });
});
