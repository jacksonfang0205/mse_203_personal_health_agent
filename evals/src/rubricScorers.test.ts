import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Workout } from "@/lib/schemas";
import { calendar, capability, diversity, injuredParts, injury, progression, type RubricCase } from "./rubricScorers";

const { cases } = JSON.parse(readFileSync(join(__dirname, "..", "cases.json"), "utf8")) as { cases: RubricCase[] };
const byId = (id: string) => cases.find((c) => c.id === id)!;
const W = "2026-11-23";
const workout = (date: string, start: string, ids: string[], durationMin = 30, extra: Partial<Workout> = {}): Workout => ({
  id: `${date}-${start}`,
  title: "Session",
  date,
  start,
  durationMin,
  category: "strength",
  muscles: [],
  equipment: [],
  exercises: ids.map((exerciseId) => ({ exerciseId, sets: 3 })),
  rationale: "",
  status: "planned",
  origin: "agent",
  ...extra,
});
const out = (ws: Workout[], extra = {}) => ({ workouts: ws, notes: [], ...extra });

describe("rubric scorers", () => {
  it("has 10 cases", () => expect(cases).toHaveLength(10));

  it("capability: flags a level above the user's and missing equipment", () => {
    const c = byId("RB-01"); // beginner, dumbbells + mat
    const s = capability(c, out([workout("2026-11-23", "19:00", ["goblet_squat", "push_up", "db_row", "bench_press"])]), W);
    expect(s.score).toBe(0.5);
    expect(s.metadata.reason).toMatch(/push_up/);
  });

  it("calendar: one overlap fails; touching end-to-start is fine; impossible week needs a message", () => {
    const c = byId("RB-01"); // club meeting Mon 18:00-19:00
    expect(calendar(c, out([workout("2026-11-23", "18:30", ["db_row"])]), W).score).toBe(0);
    expect(calendar(c, out([workout("2026-11-23", "19:00", ["db_row"])]), W).score).toBe(1);
    const trip = byId("RB-06");
    expect(calendar(trip, out([]), W).score).toBe(0);
    expect(calendar(trip, out([], { infeasibleReason: "There's no free time while you're travelling." }), W).score).toBe(1);
  });

  it("calendar: an all-day event blocks its whole day", () => {
    const c = byId("RB-10");
    expect(calendar(c, out([workout("2026-11-25", "07:00", ["db_row"])]), W).score).toBe(0);
  });

  it("diversity: repeated single exercise scores lower than a varied week", () => {
    const c = byId("RB-01");
    const allowed = ["goblet_squat", "db_row", "glute_bridge", "plank", "db_curl", "db_lateral_raise"];
    const same = diversity(c, out([workout("2026-11-23", "19:00", ["goblet_squat"]), workout("2026-11-25", "19:00", ["goblet_squat"])]), W, allowed).score!;
    const varied = diversity(c, out([workout("2026-11-23", "19:00", ["goblet_squat", "db_row"]), workout("2026-11-25", "19:00", ["plank", "db_curl"])]), W, allowed).score!;
    expect(varied).toBeGreaterThan(same);
  });

  it("progression: +10% is fine, +30% scores 0, returning users are capped", () => {
    const c = byId("RB-08"); // 135 min last week
    expect(progression(c, out([workout("2026-11-24", "06:00", ["row_steady"], 45), workout("2026-11-26", "06:00", ["bike_steady"], 45), workout("2026-11-28", "06:00", ["row_steady"], 45)]), W).score).toBe(1);
    expect(progression(c, out(Array.from({ length: 4 }, (_, i) => workout(`2026-11-2${4 + i}`, "06:00", ["bike_steady"], 45))), W).score).toBe(0);
    const back = byId("RB-07"); // target 300, cap 201
    expect(progression(back, out(Array.from({ length: 5 }, (_, i) => workout(`2026-11-2${3 + i}`, "18:00", ["db_row"], 60))), W).score).toBe(0);
  });

  it("injury: finds a vague knee complaint in the chat and flags squats", () => {
    const c = byId("RB-09");
    expect(injuredParts(c)).toEqual(["knee"]);
    const s = injury(c, out([workout("2026-11-26", "19:00", ["goblet_squat", "db_row", "plank", "db_curl"])]), W);
    expect(s.score).toBe(0.75);
    expect(s.metadata.reason).toMatch(/Critical/);
    expect(injury(byId("RB-01"), out([]), W).score).toBeNull();
  });
});
