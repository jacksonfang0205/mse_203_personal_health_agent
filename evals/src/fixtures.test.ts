/**
 * Integrity checks for eval fixtures. These catch broken references and
 * split leakage before they silently skew a metric.
 */
import { describe, expect, it } from "vitest";
import { validatePlan } from "@/lib/validation";
import { buildScenarioContext, loadBaselines, loadPersonas, loadScenarios, personaBusy } from "./fixtures";

const { referenceWeek, personas } = loadPersonas();
const { plans } = loadBaselines();
const dev = loadScenarios("dev");
const heldout = loadScenarios("heldout");
const all = [...dev, ...heldout];

const inWeek = (d: string) => d >= referenceWeek.start && d <= referenceWeek.end;

describe("eval fixtures", () => {
  it("has at least 30 synthetic scenarios with unique ids", () => {
    expect(all.length).toBeGreaterThanOrEqual(30);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    expect(all.every((s) => s.synthetic)).toBe(true);
  });

  it("keeps dev and held-out splits separate", () => {
    expect(dev.every((s) => s.split === "dev" && s.id.startsWith("DEV-"))).toBe(true);
    expect(heldout.every((s) => s.split === "heldout" && s.id.startsWith("HO-"))).toBe(true);
    const devMessages = new Set(dev.map((s) => s.userMessage.toLowerCase()));
    expect(heldout.filter((s) => devMessages.has(s.userMessage.toLowerCase()))).toEqual([]);
  });

  it("covers every disruption category in both splits or dev at least", () => {
    const required = [
      "unexpected_meeting",
      "missed_workout",
      "reduced_time",
      "equipment_change",
      "conflicting_preferences",
      "no_feasible_window",
    ];
    for (const c of required) expect(dev.some((s) => s.category === c)).toBe(true);
  });

  it("has a valid, frozen baseline plan per persona", () => {
    for (const p of personas) {
      const plan = plans[p.id];
      expect(plan, p.id).toBeDefined();
      const r = validatePlan(plan, { profile: p.profile, busy: personaBusy(p, referenceWeek), knownRange: referenceWeek });
      expect(r.violations, p.id).toEqual([]);
    }
  });

  for (const s of all) {
    it(`${s.id} references real personas, workouts, and dates`, () => {
      const plan = plans[s.personaId];
      expect(plan, "persona baseline").toBeDefined();
      const ids = new Set(plan.workouts.map((w) => w.id));
      const refs = [...s.setup.completed, ...s.setup.skipped, ...s.expected.mustChange, ...s.expected.mustKeep];
      for (const id of refs) expect(ids.has(id), id).toBe(true);
      expect(inWeek(s.now.date)).toBe(true);
      for (const b of s.groundTruth.addedBusy) expect(inWeek(b.date)).toBe(true);
      for (const d of Object.keys(s.groundTruth.dateLimits)) expect(inWeek(d)).toBe(true);
      if (s.expected.outcome === "plan") expect(refs).toEqual([]);
      // Completed workouts must already be in the past at scenario time.
      const { plan: scenarioPlan } = buildScenarioContext(s, personas, plans, referenceWeek);
      for (const w of scenarioPlan.workouts.filter((w) => w.status === "completed")) {
        expect(w.date <= s.now.date, w.id).toBe(true);
      }
    });
  }
});
