import { describe, expect, it } from "vitest";
import { DEMO_PROFILE } from "./demo";
import { firstUp, joinAnd, revealReasons } from "./planReveal";
import { FitnessProfile, type WeeklyPlan } from "./schemas";
import { buildSamplePlan, calendarForWeek } from "./session";

const profile = FitnessProfile.parse({ ...DEMO_PROFILE, updatedAt: "2026-11-11T08:00:00.000Z" });
const now = { date: "2026-11-09", time: "07:00" };

function plan(): WeeklyPlan {
  return buildSamplePlan({ profile, preset: "student", now, createdAt: "2026-11-09T07:00:00.000Z" });
}

describe("plan reveal", () => {
  it("explains a template week without claiming anything it didn't do", () => {
    const p = plan();
    const { busy } = calendarForWeek("student", now.date);
    const reasons = revealReasons(profile, p, busy);
    const keys = reasons.map((r) => r.key);
    expect(keys).toContain("schedule");
    expect(keys).toContain("goals");
    expect(keys).toContain("calendar");
    expect(keys).toContain("boundaries");
    const schedule = reasons.find((r) => r.key === "schedule")!;
    expect(schedule.body).toMatch(new RegExp(`^${p.workouts.length} workouts? on `));
  });

  it("says when a session falls outside the preferred days or times", () => {
    const p = plan();
    const moved = { ...p, workouts: p.workouts.map((w, i) => (i === 0 ? { ...w, start: "23:00" } : w)) };
    const schedule = revealReasons(profile, moved, []).find((r) => r.key === "schedule")!;
    expect(schedule.body).toContain("outside your usual days or times");
    expect(schedule.body).toContain("11 pm");
  });

  it("only promises rest days when no two workouts are back to back", () => {
    const p = plan();
    const w = p.workouts[0];
    const backToBack = { ...p, workouts: [{ ...w, date: "2026-11-09" }, { ...w, id: "x", date: "2026-11-10" }] };
    expect(revealReasons(profile, backToBack, []).some((r) => r.key === "recovery")).toBe(false);
    const spaced = { ...p, workouts: [{ ...w, date: "2026-11-09" }, { ...w, id: "x", date: "2026-11-11" }] };
    expect(revealReasons(profile, spaced, []).some((r) => r.key === "recovery")).toBe(true);
  });

  it("points to the first workout when today is a rest day", () => {
    const p = plan();
    const later = { ...p, workouts: p.workouts.filter((w) => w.date > now.date) };
    expect(firstUp(later, now.date)).toMatch(/^Today is a rest day\. Your first workout is /);
    const today = { ...p, workouts: [{ ...p.workouts[0], date: now.date, start: "18:00" }] };
    expect(firstUp(today, now.date)).toMatch(/^Your first workout is today at 6 pm: /);
  });

  it("joins lists in plain English", () => {
    expect(joinAnd(["Mon"])).toBe("Mon");
    expect(joinAnd(["Mon", "Wed"])).toBe("Mon and Wed");
    expect(joinAnd(["Mon", "Wed", "Fri"])).toBe("Mon, Wed and Fri");
  });
});

describe("goal line", () => {
  it("reads naturally for a single-category week", () => {
    const p = plan();
    const strengthOnly = { ...p, workouts: p.workouts.map((w) => ({ ...w, category: "strength" as const })) };
    const goals = revealReasons(profile, strengthOnly, []).find((r) => r.key === "goals")!;
    expect(goals.body).toMatch(/^All \d strength sessions, because you want to /);
  });
});
