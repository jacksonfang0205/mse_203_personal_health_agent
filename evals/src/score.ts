/**
 * Objective scoring for one scenario. Subjective acceptance (would a user pick
 * this?) is NOT scored here; it comes from user studies and rubric review.
 */
import { applyOperations } from "@/lib/planner/alternatives";
import type { Alternative, WeeklyPlan, Workout } from "@/lib/schemas";
import { validatePlan, type ValidationContext, type Violation } from "@/lib/validation";
import type { PlannerOutput } from "./planners";
import type { Scenario } from "./fixtures";

export interface AlternativeScore {
  id: string;
  kind: Alternative["kind"] | "plan";
  valid: boolean;
  resolves: boolean;
  violations: Violation[];
  unresolved: string[];
  /** mustKeep workouts this option changed. */
  disturbed: string[];
}

export interface ScenarioScore {
  /** Metric 1. null when the planner proposed nothing to check. */
  constraintPass: boolean | null;
  /** Metric 3 (objective half). */
  feasible: boolean;
  feasibleReason: string;
  restOnly: boolean;
  infeasibleAcknowledged: boolean;
  alternatives: AlternativeScore[];
}

const same = (a?: Workout, b?: Workout) => JSON.stringify(a) === JSON.stringify(b);

function resolution(scenario: Scenario, before: WeeklyPlan, after: WeeklyPlan) {
  const find = (p: WeeklyPlan, id: string) => p.workouts.find((w) => w.id === id);
  return {
    unresolved: scenario.expected.mustChange.filter((id) => same(find(before, id), find(after, id))),
    disturbed: scenario.expected.mustKeep.filter((id) => !same(find(before, id), find(after, id))),
  };
}

export function scoreScenario(
  scenario: Scenario,
  output: PlannerOutput,
  ctx: ValidationContext,
  before: WeeklyPlan,
): ScenarioScore {
  if (output.kind === "plan") {
    const check = validatePlan(output.plan, ctx);
    const planned = output.plan.workouts.filter((w) => w.status === "planned").length;
    const shortfallExplained = planned >= ctx.profile.frequencyPerWeek || output.plan.notes.length > 0;
    const feasible = check.ok && planned > 0 && shortfallExplained;
    return {
      constraintPass: check.ok,
      feasible,
      feasibleReason: !check.ok
        ? "plan violates hard constraints"
        : planned === 0
          ? "empty plan"
          : !shortfallExplained
            ? "fewer sessions than requested with no explanation"
            : "ok",
      restOnly: false,
      infeasibleAcknowledged: false,
      alternatives: [
        {
          id: output.plan.id,
          kind: "plan",
          valid: check.ok,
          resolves: true,
          violations: check.violations,
          unresolved: [],
          disturbed: [],
        },
      ],
    };
  }

  const { proposal } = output;
  const alternatives: AlternativeScore[] = proposal.alternatives.map((alt) => {
    const after = applyOperations(before, alt.operations);
    const check = validatePlan(after, ctx);
    const { unresolved, disturbed } = resolution(scenario, before, after);
    return {
      id: alt.id,
      kind: alt.kind,
      valid: check.ok,
      resolves: unresolved.length === 0 && disturbed.length === 0,
      violations: check.violations,
      unresolved,
      disturbed,
    };
  });

  const constraintPass = alternatives.length ? alternatives.every((a) => a.valid) : null;
  const workable = alternatives.filter((a) => a.valid && a.resolves);
  const restOnly = workable.length > 0 && workable.every((a) => a.kind === "skip");
  const acknowledged = Boolean(proposal.infeasibleReason);

  let feasible: boolean;
  let feasibleReason: string;
  if (scenario.expected.outcome === "infeasible") {
    const keepsOk = alternatives.every((a) => a.disturbed.length === 0);
    feasible = acknowledged && constraintPass !== false && keepsOk;
    feasibleReason = !acknowledged
      ? "did not acknowledge that the request can't be met"
      : constraintPass === false
        ? "offered an option that violates constraints"
        : !keepsOk
          ? "changed workouts that should be kept"
          : "ok";
  } else {
    feasible = workable.some((a) => a.kind !== "skip");
    feasibleReason = feasible
      ? "ok"
      : !alternatives.length
        ? "no alternatives offered"
        : restOnly
          ? "only offered rest"
          : alternatives.some((a) => a.valid)
            ? "valid options don't resolve the disruption"
            : "every option violates constraints";
  }

  return { constraintPass, feasible, feasibleReason, restOnly, infeasibleAcknowledged: acknowledged, alternatives };
}
