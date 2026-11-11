/**
 * Eval fixture schemas and loaders. Dev and held-out fixtures are SYNTHETIC.
 * The survey split is grounded in real, anonymous survey responses: each
 * persona and scenario records its respondent, whether the user message is
 * verbatim, and every assumption we had to add (see `source`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { expandRecurring, type DateRange } from "@/lib/calendar";
import {
  AvoidTag,
  BusyBlock,
  ClockTime,
  Equipment,
  FitnessProfile,
  IsoDate,
  WeeklyPlan,
  Weekday,
} from "@/lib/schemas";

export const EVALS_DIR = join(__dirname, "..");

/** Where a survey-grounded fixture came from. Absent on fully synthetic fixtures. */
export const Source = z.object({
  respondent: z.string(),
  /** verbatim: the user's own words. derived: we wrote it from their answers, because their own message was unusable. */
  message: z.enum(["verbatim", "derived"]).optional(),
  /** The survey answers this fixture is built from, quoted as written. */
  surveyAnswers: z.record(z.string(), z.string()).default({}),
  /** Everything we had to fill in that the respondent did not say. */
  assumptions: z.array(z.string()).default([]),
});

const Recurring = z.object({ weekday: Weekday, start: ClockTime, end: ClockTime, title: z.string() });

export const Persona = z.object({
  id: z.string(),
  synthetic: z.boolean(),
  summary: z.string(),
  source: Source.optional(),
  profile: FitnessProfile,
  calendar: z.array(Recurring),
});
export type Persona = z.infer<typeof Persona>;

export const PersonaFile = z.object({
  referenceWeek: z.object({ start: IsoDate, end: IsoDate }),
  personas: z.array(Persona),
});

export const BaselineFile = z.object({
  generatedWith: z.string(),
  plans: z.record(z.string(), WeeklyPlan),
});

export const SCENARIO_CATEGORIES = [
  "initial_plan",
  "unexpected_meeting",
  "missed_workout",
  "reduced_time",
  "equipment_change",
  "activity_restriction",
  "conflicting_preferences",
  "no_feasible_window",
  "preserve_completed",
  "multi_change",
  // Found in the survey: workouts missed for low energy or caregiving, not schedule conflicts.
  "low_energy",
  "caregiving",
] as const;

export const SPLITS = ["dev", "heldout", "survey"] as const;


const AddedBusy = z.object({
  date: IsoDate,
  start: ClockTime,
  end: ClockTime,
  title: z.string(),
  /** True if the event is on the user's calendar (visible to calendar tools). False = only in the message. */
  inCalendar: z.boolean(),
});

export const Scenario = z.object({
  id: z.string().regex(/^(DEV|HO|SV)-\d{2}$/),
  split: z.enum(SPLITS),
  synthetic: z.boolean(),
  source: Source.optional(),
  category: z.enum(SCENARIO_CATEGORIES),
  title: z.string(),
  personaId: z.string(),
  now: z.object({ date: IsoDate, time: ClockTime }),
  /** Status changes applied to the persona's baseline plan before the scenario starts. */
  setup: z
    .object({
      completed: z.array(z.string()).default([]),
      skipped: z.array(z.string()).default([]),
    })
    .default({ completed: [], skipped: [] }),
  userMessage: z.string(),
  /** What is actually true. Validators use this; planners only see what they could legitimately know. */
  groundTruth: z
    .object({
      addedBusy: z.array(AddedBusy).default([]),
      dateLimits: z.record(IsoDate, z.number().int().min(0)).default({}),
      equipmentAvailable: z.array(Equipment).optional(),
      extraAvoidTags: z.array(AvoidTag).default([]),
    })
    .default({ addedBusy: [], dateLimits: {}, extraAvoidTags: [] }),
  expected: z.object({
    /** plan: generate a week. replan: offer a feasible change. infeasible: say so without inventing time. */
    outcome: z.enum(["plan", "replan", "infeasible"]),
    /** Workouts that must be moved, replaced, or skipped for the disruption to be resolved. */
    mustChange: z.array(z.string()).default([]),
    /** Workouts that must come through untouched (completed ones are always checked). */
    mustKeep: z.array(z.string()).default([]),
    notes: z.string(),
  }),
});
export type Scenario = z.infer<typeof Scenario>;

export const ScenarioFile = z.object({
  split: z.enum(SPLITS),
  scenarios: z.array(Scenario),
});

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(EVALS_DIR, rel), "utf8"));
}

export function loadPersonas() {
  return PersonaFile.parse(readJson("fixtures/personas.json"));
}

export function loadBaselines() {
  return BaselineFile.parse(readJson("fixtures/baseline-plans.json"));
}

export function loadScenarios(split: (typeof SPLITS)[number] | "all"): Scenario[] {
  const files = split === "all" ? ["dev", "heldout"] : [split];
  return files.flatMap((f) => ScenarioFile.parse(readJson(`scenarios/${f}.json`)).scenarios);
}

export function personaBusy(persona: Persona, range: DateRange): BusyBlock[] {
  return expandRecurring(persona.calendar, range);
}

/** Everything the scenario needs, split into what planners may see and what validators know. */
export function buildScenarioContext(
  scenario: Scenario,
  personas: Persona[],
  baselines: Record<string, WeeklyPlan>,
  range: DateRange,
) {
  const persona = personas.find((p) => p.id === scenario.personaId);
  if (!persona) throw new Error(`${scenario.id}: unknown persona ${scenario.personaId}`);
  const baseline = baselines[persona.id];
  if (!baseline) throw new Error(`${scenario.id}: no baseline plan for ${persona.id}`);

  const plan: WeeklyPlan = {
    ...baseline,
    workouts: baseline.workouts.map((w) => ({
      ...w,
      status: scenario.setup.completed.includes(w.id)
        ? "completed"
        : scenario.setup.skipped.includes(w.id)
          ? "skipped"
          : w.status,
    })),
  };

  const calendarBusy = personaBusy(persona, range);
  const added: BusyBlock[] = scenario.groundTruth.addedBusy.map((b, i) => ({
    id: `${scenario.id}-added-${i}`,
    date: b.date,
    start: b.start,
    end: b.end,
    title: b.title,
    source: b.inCalendar ? "simulated" : "user_message",
  }));

  return {
    persona,
    plan,
    /** What a calendar tool would return. */
    visibleBusy: [...calendarBusy, ...added.filter((b) => b.source === "simulated")],
    /** Ground truth for validation. */
    trueBusy: [...calendarBusy, ...added],
  };
}
