import { describe, expect, it } from "vitest";
import type { Alternative, PlanOperation, Workout } from "@/lib/schemas";
import { buildScenarioContext, loadBaselines, loadPersonas, loadScenarios } from "./fixtures";
import { scoreScenario } from "./score";

const { referenceWeek, personas } = loadPersonas();
const { plans } = loadBaselines();
const scenario = loadScenarios("dev").find((s) => s.id === "DEV-20")!;
const { plan, trueBusy, persona } = buildScenarioContext(scenario, personas, plans, referenceWeek);
const ctx = {
  profile: persona.profile,
  busy: trueBusy,
  knownRange: referenceWeek,
  now: scenario.now,
  previousPlan: plan,
  dateLimits: scenario.groundTruth.dateLimits,
  extraAvoidTags: scenario.groundTruth.extraAvoidTags,
};

// DEV-20: Monday's workout was missed and Wednesday has only 15 minutes.
const wednesday = plan.workouts.find((w) => w.id === "jordan-w2")!;
const shortWednesday: Workout = {
  ...wednesday,
  durationMin: 15,
  exercises: [
    { exerciseId: "sun_salutation", minutes: 8 },
    { exerciseId: "yoga_wind_down", minutes: 6 },
  ],
};

const option = (kind: Alternative["kind"], operations: PlanOperation[]): Alternative => ({
  id: kind,
  kind,
  title: kind,
  summary: kind,
  tradeoffs: [],
  operations,
});

const score = (alternatives: Alternative[]) =>
  scoreScenario(
    scenario,
    {
      kind: "proposal",
      proposal: { id: "p", createdAt: "", userMessage: scenario.userMessage, understood: [], alternatives, generatedBy: "agent" },
    },
    ctx,
    plan,
  );

describe("replanning score", () => {
  it("counts a skip-labeled option that also changes a workout as a real change", () => {
    const s = score([
      option("skip", [
        { op: "skip", workoutId: "jordan-w1" },
        { op: "replace", workoutId: "jordan-w2", workout: shortWednesday },
      ]),
    ]);
    expect(s.constraintPass).toBe(true);
    expect(s.restOnly).toBe(false);
    expect(s.feasible).toBe(true);
  });

  it("still fails an answer that only skips workouts", () => {
    const s = score([
      option("skip", [
        { op: "skip", workoutId: "jordan-w1" },
        { op: "skip", workoutId: "jordan-w2" },
      ]),
    ]);
    expect(s.restOnly).toBe(true);
    expect(s.feasible).toBe(false);
  });
});
