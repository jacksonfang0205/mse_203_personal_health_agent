/**
 * Planner adapters under evaluation.
 *
 * Every system we compare implements `Planner`, so the harness and scoring
 * stay identical across conditions. Phase 1 ships two non-AI planners that
 * exercise the harness and set a floor:
 *
 *   noop        never proposes anything (sanity floor; should fail replanning)
 *   rule_based  the deterministic template + rule-based alternatives used in
 *               the app preview. It ignores the user's message.
 *
 * Phase 2 adds `generic_llm` (no tools, no memory) and `pivot_agent`
 * (tools + persistent profile/history).
 */
import type { DateRange } from "@/lib/calendar";
import { proposeRuleBasedAlternatives } from "@/lib/planner/alternatives";
import { generateMockWeek } from "@/lib/planner/generate";
import type { BusyBlock, ClockTime, FitnessProfile, IsoDate, Proposal, WeeklyPlan } from "@/lib/schemas";
import { genericLlmPlanner, pivotAgentPlanner } from "./llmPlanners";

export interface PlannerInput {
  scenarioId: string;
  userMessage: string;
  now: { date: IsoDate; time: ClockTime };
  weekStart: IsoDate;
  profile: FitnessProfile;
  /** Current plan. Absent for initial planning. */
  plan?: WeeklyPlan;
  /** What a calendar tool would return. Events mentioned only in the message are NOT here. */
  calendar: { busy: BusyBlock[]; knownRange: DateRange };
}

export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export type PlannerOutput =
  | { kind: "plan"; plan: WeeklyPlan; responseText?: string; usage?: Usage[] }
  | { kind: "proposal"; proposal: Proposal; responseText?: string; usage?: Usage[] };

export interface Planner {
  id: string;
  description: string;
  generatePlan(input: PlannerInput): Promise<PlannerOutput>;
  replan(input: PlannerInput & { plan: WeeklyPlan }): Promise<PlannerOutput>;
}

const emptyProposal = (input: PlannerInput): Proposal => ({
  id: `${input.scenarioId}-noop`,
  createdAt: `${input.now.date}T${input.now.time}:00`,
  userMessage: input.userMessage,
  understood: [],
  alternatives: [],
  generatedBy: "rule_based_mock",
});

export const noopPlanner: Planner = {
  id: "noop",
  description: "Returns no changes and an empty plan. Harness sanity floor.",
  async generatePlan(input) {
    return {
      kind: "plan",
      plan: {
        id: "noop",
        weekStart: input.weekStart,
        workouts: [],
        generatedBy: "mock_template",
        createdAt: "",
        notes: [],
      },
    };
  },
  async replan(input) {
    return { kind: "proposal", proposal: emptyProposal(input) };
  },
};

export const ruleBasedPlanner: Planner = {
  id: "rule_based",
  description: "Deterministic template planner + rule-based alternatives (ignores the message).",
  async generatePlan(input) {
    const plan = generateMockWeek({
      profile: input.profile,
      weekStart: input.weekStart,
      busy: input.calendar.busy,
      now: input.now,
      createdAt: `${input.now.date}T${input.now.time}:00`,
    });
    return { kind: "plan", plan };
  },
  async replan(input) {
    const proposal = proposeRuleBasedAlternatives({
      plan: input.plan,
      profile: input.profile,
      busy: input.calendar.busy,
      knownRange: input.calendar.knownRange,
      now: input.now,
      userMessage: input.userMessage,
      proposalId: input.scenarioId,
      createdAt: `${input.now.date}T${input.now.time}:00`,
    });
    return { kind: "proposal", proposal };
  },
};

export const PLANNERS: Record<string, Planner> = {
  [noopPlanner.id]: noopPlanner,
  [ruleBasedPlanner.id]: ruleBasedPlanner,
  [genericLlmPlanner.id]: genericLlmPlanner,
  [pivotAgentPlanner.id]: pivotAgentPlanner,
};
