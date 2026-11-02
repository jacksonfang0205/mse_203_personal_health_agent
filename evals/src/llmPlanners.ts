/**
 * LLM planners under evaluation (EVAL_PLAN.md, conditions B and C).
 *
 *   pivot_agent  Pivot's real agent code: catalog filtered to what the user can
 *                do, free windows computed for it, validation gate, one repair
 *                round, collateral fixes. Memory is empty in these scenarios.
 *   generic_llm  One prompt with the same profile, calendar, plan, message,
 *                full catalog and the same written rules. No validation, no
 *                repair, no pre-filtering: it must get everything right itself.
 *
 * Both use the model from LLM_MODEL (gpt-5.4-mini by default), so the variable
 * under test is the harness around the model, not the model.
 */
import { z } from "zod";
import type { AgentRequest } from "@/lib/agent/context";
import { agentLifeHappens } from "@/lib/agent/lifeHappens";
import { callTool } from "@/lib/agent/llm";
import { agentPlanWeek } from "@/lib/agent/plan";
import { EXERCISES, getExercise } from "@/lib/catalog";
import { ALTERNATIVE_KINDS, WorkoutCategory, type PlanOperation, type Proposal, type Workout } from "@/lib/schemas";
import type { Planner, PlannerInput } from "./planners";

// ---------- C. Pivot agent ----------

function agentRequest(input: PlannerInput): AgentRequest {
  return {
    profile: input.profile,
    plan: input.plan ?? null,
    history: [],
    blocked: [],
    notes: [],
    log: [],
    calendarPreset: "student", // ignored: the scenario calendar below is used instead
    now: input.now,
    calendar: input.calendar,
  };
}

export const pivotAgentPlanner: Planner = {
  id: "pivot_agent",
  description: "Pivot agent: filtered catalog, free windows, validation gate, repair round, collateral fixes.",
  async generatePlan(input) {
    const r = await agentPlanWeek(agentRequest(input));
    return { kind: "plan", plan: r.plan, usage: r.usage ? [r.usage] : [] };
  },
  async replan(input) {
    const r = await agentLifeHappens({ ...agentRequest(input), plan: input.plan, message: input.userMessage });
    return { kind: "proposal", proposal: r.proposal, usage: r.usage, responseText: r.fallback };
  },
};

// ---------- B. Generic LLM ----------

const opt = <T extends z.ZodType>(s: T) => s.nullish();

// Plain strings for dates and times: a malformed value should fail validation, not parsing.
const WorkoutSpec = z.object({
  date: z.string().describe("YYYY-MM-DD"),
  start: z.string().describe("HH:MM, 24h"),
  durationMin: z.number(),
  category: WorkoutCategory,
  title: z.string(),
  exercises: z
    .array(
      z.object({
        exerciseId: z.string().describe("id from the catalog"),
        sets: opt(z.number().int()),
        reps: opt(z.string()),
        seconds: opt(z.number().int()),
        minutes: opt(z.number().int()),
      }),
    )
    .min(1),
  rationale: z.string(),
});
type WorkoutSpec = z.infer<typeof WorkoutSpec>;

const PlanOutput = z.object({ workouts: z.array(WorkoutSpec), notes: z.array(z.string()) });

const ProposalOutput = z.object({
  understood: z.array(z.string()),
  alternatives: z
    .array(
      z.object({
        kind: z.enum(ALTERNATIVE_KINDS),
        title: z.string(),
        summary: z.string(),
        tradeoffs: z.array(z.string()),
        operations: z.array(
          z.object({
            op: z.enum(["move", "replace", "skip", "add"]),
            workoutId: opt(z.string()).describe("move/replace/skip: id from the current plan"),
            date: opt(z.string()).describe("move: new YYYY-MM-DD"),
            start: opt(z.string()).describe("move: new HH:MM"),
            workout: opt(WorkoutSpec).describe("replace/add: the new workout"),
          }),
        ),
      }),
    )
    .max(3),
  infeasibleReason: opt(z.string()).describe("only when no option works"),
});

const RULES = `Rules the plan must follow:
- Never schedule over busy calendar time, or over anything the user's message says is newly busy.
- Workouts must start and end between 06:00 and 22:00, within the week shown, and never in the past.
- Each workout's durationMin is at most the user's sessionMinutes, and its exercises must fit in that time.
- Only use exercises from the catalog, only with equipment the user has, and never anything with a tag or id the user avoids.
- At most the user's frequencyPerWeek workouts, at most one per day. Never add make-up sessions or extra sets.
- Never change completed workouts.
- No medical or rehab advice.`;

function catalogForPrompt() {
  return EXERCISES.map((e) => ({
    id: e.id,
    name: e.name,
    category: e.category,
    muscles: e.muscles,
    equipment: e.equipment,
    level: e.level,
    tags: e.tags,
    prescription: e.prescription,
    minutes: e.minutes,
  }));
}

function context(input: PlannerInput) {
  return [
    `Now: ${input.now.date} ${input.now.time}. The week runs ${input.calendar.knownRange.start} to ${input.calendar.knownRange.end}.`,
    `<profile>${JSON.stringify(input.profile)}</profile>`,
    `<calendar_busy>${JSON.stringify(input.calendar.busy.map((b) => ({ date: b.date, start: b.start, end: b.end, title: b.title })))}</calendar_busy>`,
    `<catalog>${JSON.stringify(catalogForPrompt())}</catalog>`,
  ].join("\n");
}

/** Fill in muscles and equipment from the catalog. Formatting only; nothing is checked or repaired. */
function toWorkout(spec: WorkoutSpec, id: string): Workout {
  const used = spec.exercises.map((e) => getExercise(e.exerciseId)).filter((e) => e !== undefined);
  return {
    id,
    title: spec.title,
    date: spec.date,
    start: spec.start,
    durationMin: Math.round(spec.durationMin),
    category: spec.category,
    muscles: [...new Set(used.flatMap((e) => e.muscles))],
    equipment: [...new Set(used.flatMap((e) => e.equipment))],
    exercises: spec.exercises.map((e) => ({
      exerciseId: e.exerciseId,
      sets: e.sets ?? undefined,
      reps: e.reps ?? undefined,
      seconds: e.seconds ?? undefined,
      minutes: e.minutes ?? undefined,
    })),
    rationale: spec.rationale,
    status: "planned",
    origin: "agent",
  };
}

const SYSTEM = "You are a helpful fitness planning assistant. Answer by calling the tool exactly once.";

export const genericLlmPlanner: Planner = {
  id: "generic_llm",
  description: "Single-shot LLM with the same information and rules; no validation, repair, or pre-filtering.",
  async generatePlan(input) {
    const res = await callTool({
      system: SYSTEM,
      user: `${context(input)}\n\n${RULES}\n\nPlan this person's workouts for the rest of the week.`,
      name: "propose_week",
      description: "Propose this week's workouts.",
      schema: PlanOutput,
    });
    return {
      kind: "plan",
      plan: {
        id: `generic-${input.scenarioId}`,
        weekStart: input.weekStart,
        workouts: res.output.workouts.map((w, i) => toWorkout(w, `g-${i}`)),
        generatedBy: "agent",
        createdAt: `${input.now.date}T${input.now.time}:00`,
        notes: res.output.notes,
      },
      usage: [res.usage],
    };
  },
  async replan(input) {
    const res = await callTool({
      system: SYSTEM,
      user: [
        context(input),
        `<current_plan>${JSON.stringify(input.plan.workouts)}</current_plan>`,
        RULES,
        `The user says: "${input.userMessage}"`,
        "Offer up to three different ways to adapt the plan, as operations on the current plan. Each option must be honest about its tradeoffs. If nothing works, offer none and explain in infeasibleReason.",
      ].join("\n\n"),
      name: "propose_alternatives",
      description: "Propose up to three ways to adapt the plan.",
      schema: ProposalOutput,
    });
    const out = res.output;
    // Operations are passed through as given; anything malformed fails validation in scoring.
    const proposal: Proposal = {
      id: `generic-${input.scenarioId}`,
      createdAt: `${input.now.date}T${input.now.time}:00`,
      userMessage: input.userMessage,
      understood: out.understood,
      alternatives: out.alternatives.map((a, i) => ({
        id: `generic-${input.scenarioId}-${i}`,
        kind: a.kind,
        title: a.title,
        summary: a.summary,
        tradeoffs: a.tradeoffs,
        operations: a.operations.map((o, j) => {
          const id = o.workoutId ?? "";
          if (o.op === "move") return { op: "move", workoutId: id, date: o.date, start: o.start } as PlanOperation;
          if (o.op === "skip") return { op: "skip", workoutId: id };
          const w = o.workout ? toWorkout(o.workout, o.op === "replace" ? id : `g-add-${i}-${j}`) : undefined;
          return (o.op === "replace" ? { op: "replace", workoutId: id, workout: w } : { op: "add", workout: w }) as PlanOperation;
        }),
      })),
      infeasibleReason: out.infeasibleReason ?? undefined,
      generatedBy: "agent",
    };
    return { kind: "proposal", proposal, usage: [res.usage] };
  },
};
