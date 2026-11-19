/**
 * Braintrust eval: Pivot's weekly plan, scored on the five criteria in evals/rubric.md.
 *
 *   npm run eval:bt                          # Pivot (the app's real planner path)
 *   EVAL_PLANNER=generic npm run eval:bt     # baseline: one LLM call, no validation
 *
 * Dataset: evals/cases.json (10 synthetic cases). For each case the task builds the
 * week the way the app does, then, if the case has a message other than "Plan my
 * week", sends it to the coach and applies the first option (what a user would most
 * likely tap). Keys come from .env.local via --env-file; nothing is printed.
 *
 * Calendar note: all-day events are dropped before planning, exactly as the app's
 * Google Calendar import does today. The calendar scorer still counts them as busy,
 * so RB-10 shows that gap until the import is fixed.
 */
import { Eval } from "braintrust";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRequest } from "@/lib/agent/context";
import { agentLifeHappens } from "@/lib/agent/lifeHappens";
import { aiEnabled, modelName } from "@/lib/agent/llm";
import { agentPlanWeek, templatePlanWeek } from "@/lib/agent/plan";
import { EXERCISES } from "@/lib/catalog";
import { applyOperations, proposeRuleBasedAlternatives } from "@/lib/planner/alternatives";
import type { BusyBlock, FitnessProfile, Proposal, WeeklyPlan, WorkoutType } from "@/lib/schemas";
import { genericLlmPlanner } from "./src/llmPlanners";
import {
  capability,
  calendar,
  diversity,
  FORBIDDEN,
  injury,
  injuredParts,
  progression,
  type PlanOutput,
  type RubricCase,
} from "./src/rubricScorers";

const file = JSON.parse(readFileSync(join(process.cwd(), "evals", "cases.json"), "utf8")) as {
  referenceWeek: { start: string; end: string };
  cases: RubricCase[];
};
const WEEK = file.referenceWeek;
const PLANNER = process.env.EVAL_PLANNER === "generic" ? "generic_llm" : "pivot_agent";
const RANK = { beginner: 0, intermediate: 1, advanced: 2 } as const;

// ---------- Case → app inputs ----------

/** The cases describe what people enjoy through goals and equipment; the app also needs workout types. */
function workoutTypes(p: RubricCase["profile"]): WorkoutType[] {
  const eq = new Set(p.equipment);
  const types = new Set<WorkoutType>();
  if (p.goals.some((g) => g === "strength" || g === "fat_loss" || g === "general_fitness")) types.add(eq.size ? "gym" : "home");
  if (p.goals.includes("endurance")) {
    if (eq.has("stationary_bike")) types.add("cycling");
    types.add(eq.has("treadmill") || !eq.size ? "running" : "walking");
  }
  if (p.goals.includes("mobility") || p.goals.includes("stress_relief")) types.add("yoga");
  if (p.goals.includes("fat_loss") || p.goals.includes("general_fitness")) types.add("walking");
  return types.size ? [...types] : ["home"];
}

function profileOf(c: RubricCase): FitnessProfile {
  return {
    ...(c.profile as unknown as FitnessProfile),
    version: 1,
    targetMuscles: [],
    workoutTypes: workoutTypes(c.profile),
    goalNotes: c.profile.goalNotes || undefined,
    updatedAt: `${c.now.date}T00:00:00.000Z`,
  };
}

function busyOf(c: RubricCase): BusyBlock[] {
  // All-day events are skipped, like the app's Google Calendar import (see the note at the top).
  return c.calendar
    .filter((b) => !b.allDay && b.start && b.end)
    .map((b, i) => ({ id: `${c.id}-b${i}`, date: b.date, start: b.start!, end: b.end!, title: b.title, source: "google" as const }));
}

function requestOf(c: RubricCase): AgentRequest {
  return {
    profile: profileOf(c),
    plan: null,
    history: [],
    blocked: [],
    notes: [],
    log: (c.priorWeek?.completed ?? []).map((x, i) => ({
      workoutId: `prior-${i}`,
      date: x.date,
      start: "07:00",
      durationMin: x.durationMin,
      category: x.category as never,
      status: "completed" as const,
      at: `${x.date}T08:00:00.000Z`,
    })),
    calendarPreset: "student",
    now: c.now,
    calendar: { busy: busyOf(c), knownRange: { start: WEEK.start, end: WEEK.end } },
  };
}

const isPlanRequest = (m?: string) => !m || /^plan my week\.?$/i.test(m.trim());

// ---------- Task: the app's own request path ----------

interface TaskOutput extends PlanOutput {
  planner: string;
  planSource: string;
  fallback?: string;
  coach?: { understood: string[]; options: { kind: string; title: string; summary: string }[]; applied?: string; source: string };
}

/** Same steps as POST /api/plan: AI plan through the validation gate, template plan if the AI fails or places nothing. */
async function planWeek(req: AgentRequest): Promise<{ plan: WeeklyPlan; source: string; fallback?: string }> {
  if (!aiEnabled()) {
    const t = templatePlanWeek(req, "AI isn't configured, so this is a template plan.");
    return { plan: t.plan, source: "template", fallback: t.fallback };
  }
  try {
    const r = await agentPlanWeek(req);
    if (!r.plan.workouts.some((w) => w.origin === "agent") && req.profile.frequencyPerWeek > 0) {
      const t = templatePlanWeek(req, "The AI couldn't place any sessions, so this is a template plan.");
      if (t.plan.workouts.length) return { plan: t.plan, source: "template", fallback: t.fallback };
    }
    return { plan: r.plan, source: r.plan.generatedBy, fallback: r.fallback };
  } catch (e) {
    const t = templatePlanWeek(req, `AI planning failed (${(e as Error).message}).`);
    return { plan: t.plan, source: "template", fallback: t.fallback };
  }
}

/** Same as the coach chat: AI options checked by the gate; rule-based options if the AI call fails. */
async function coach(req: AgentRequest, plan: WeeklyPlan, message: string): Promise<{ proposal: Proposal; source: string }> {
  try {
    const r = await agentLifeHappens({ ...req, plan, message });
    return { proposal: r.proposal, source: r.fallback ? "rule_based_fallback" : "agent" };
  } catch {
    const proposal = proposeRuleBasedAlternatives({
      plan,
      profile: req.profile,
      busy: req.calendar!.busy,
      knownRange: req.calendar!.knownRange,
      now: req.now,
      userMessage: message,
      proposalId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    });
    return { proposal, source: "rule_based_fallback" };
  }
}

async function runPivot(c: RubricCase): Promise<TaskOutput> {
  const req = requestOf(c);
  const { plan, source, fallback } = await planWeek(req);
  let final = plan;
  let coachOut: TaskOutput["coach"];
  let infeasibleReason: string | undefined;
  if (!isPlanRequest(c.userMessage)) {
    const { proposal, source: coachSource } = await coach(req, plan, c.userMessage!);
    const first = proposal.alternatives[0];
    if (first) final = applyOperations(plan, first.operations);
    infeasibleReason = proposal.infeasibleReason;
    coachOut = {
      understood: proposal.understood,
      options: proposal.alternatives.map((a) => ({ kind: a.kind, title: a.title, summary: a.summary })),
      applied: first?.title,
      source: coachSource,
    };
  }
  return { planner: "pivot_agent", planSource: source, fallback, workouts: final.workouts, notes: final.notes, infeasibleReason, coach: coachOut };
}

async function runGeneric(c: RubricCase): Promise<TaskOutput> {
  const req = requestOf(c);
  const input = { scenarioId: c.id, userMessage: c.userMessage ?? "Plan my week.", now: c.now, weekStart: WEEK.start, profile: req.profile, calendar: req.calendar! };
  const first = await genericLlmPlanner.generatePlan(input);
  let plan = first.kind === "plan" ? first.plan : null;
  if (!plan) throw new Error("generic planner returned no plan");
  let infeasibleReason: string | undefined;
  let coachOut: TaskOutput["coach"];
  if (!isPlanRequest(c.userMessage)) {
    const r = await genericLlmPlanner.replan({ ...input, plan });
    if (r.kind === "proposal") {
      const alt = r.proposal.alternatives[0];
      if (alt) plan = applyOperations(plan, alt.operations);
      infeasibleReason = r.proposal.infeasibleReason;
      coachOut = { understood: r.proposal.understood, options: r.proposal.alternatives.map((a) => ({ kind: a.kind, title: a.title, summary: a.summary })), applied: alt?.title, source: "generic_llm" };
    }
  }
  return { planner: "generic_llm", planSource: "generic_llm", workouts: plan.workouts, notes: plan.notes, infeasibleReason, coach: coachOut };
}

// ---------- Scorers (rules in evals/rubric.md) ----------

/** Exercises this user could do at all: level, equipment, and not ruled out by an injury. For diversity's coverage part. */
function allowedIds(c: RubricCase): string[] {
  const forbidden = new Set(injuredParts(c).flatMap((p) => FORBIDDEN[p]));
  const have = new Set(c.profile.equipment);
  return EXERCISES.filter((e) => RANK[e.level] <= RANK[c.profile.experience] && e.equipment.every((q) => have.has(q)) && !forbidden.has(e.id)).map((e) => e.id);
}

type Input = { case: string; data: RubricCase };
type Args = { input: Input; output: TaskOutput };

Eval("Pivot", {
  // EVAL_LABEL names a planner version (e.g. "planner v2"); EVAL_BASE picks the run Braintrust compares against.
  experimentName: process.env.EVAL_LABEL ? `${PLANNER} · rubric v1 · ${process.env.EVAL_LABEL}` : `${PLANNER} · rubric v1 · ${modelName()}`,
  ...(process.env.EVAL_BASE ? { baseExperimentName: process.env.EVAL_BASE } : {}),
  description: "Weekly plans for evals/cases.json, scored on capability, calendar, diversity, progression and injury (evals/rubric.md).",
  metadata: { planner: PLANNER, model: modelName(), cases: "evals/cases.json", rubric: "evals/rubric.md" },
  // Braintrust names every row "eval" and shows input keys alphabetically, so the case label goes
  // first ("case" sorts before "data") and in the tags, to tell rows apart at a glance.
  data: () =>
    file.cases.map((c) => ({
      input: { case: `${c.id} · ${c.title}`, data: c },
      expected: c.expected,
      tags: [c.id, c.type],
      metadata: { id: c.id, type: c.type, title: c.title },
    })),
  task: async ({ data: c }: Input) => (PLANNER === "generic_llm" ? runGeneric(c) : runPivot(c)),
  // Named functions, so each scorer shows under its own name in Braintrust's trace view.
  scores: [
    function capabilityScore({ input, output }: Args) {
      return capability(input.data, output, WEEK.start);
    },
    function calendarScore({ input, output }: Args) {
      return calendar(input.data, output, WEEK.start);
    },
    function diversityScore({ input, output }: Args) {
      return diversity(input.data, output, WEEK.start, allowedIds(input.data));
    },
    function progressionScore({ input, output }: Args) {
      return progression(input.data, output, WEEK.start);
    },
    function injuryScore({ input, output }: Args) {
      return injury(input.data, output, WEEK.start);
    },
  ],
  maxConcurrency: 2,
});

