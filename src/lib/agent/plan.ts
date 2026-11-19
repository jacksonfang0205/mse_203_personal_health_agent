/**
 * Agent weekly planning: the model picks days, times, formats and exercises
 * from the user's free windows and memory; deterministic code rebuilds every
 * workout from the catalog, repairs start times that don't fit, and keeps only
 * what passes the validation gate.
 */
import { z } from "zod";
import { learnedTimeOrder, computeInsights } from "../insights";
import { filterFromProfile } from "../planner/generate";
import { weeklyLoadBudget } from "../planner/progression";
import { ClockTime, IsoDate, MuscleGroup, WorkoutCategory, type WeeklyPlan, type Workout } from "../schemas";
import { buildSamplePlan, carryOver } from "../session";
import { addDays } from "../time";
import { validatePlan } from "../validation";
import {
  assembleWorkout,
  catalogFor,
  daysContext,
  memoryContext,
  profileContext,
  remainingDates,
  repairStart,
  weekContext,
  type AgentRequest,
} from "./context";
import { callTool, type LlmResult } from "./llm";

const PlanOutput = z.object({
  sessions: z
    .array(
      z.object({
        date: IsoDate,
        start: ClockTime,
        category: WorkoutCategory,
        minutes: z.number(),
        focus: z.array(MuscleGroup),
        title: z.string().describe("2-4 words, e.g. 'Lower body strength'"),
        exerciseIds: z.array(z.string()).describe("ids from <catalog>, in order"),
        rationale: z.string().describe("one sentence, at most 25 words: which goal it serves and why this slot"),
      }),
    )
    .max(7),
  notes: z.array(z.string()).max(3).describe("only goals or constraints the plan could not meet; empty if none"),
});

const SYSTEM = `You are Pivot's planning agent. You plan a week of workouts for one person.

Rules:
- Schedule exactly the number of sessions asked for, one per day at most, on the dates listed.
- A session's start and start+minutes must fit inside one of that day's "free" windows. Never use busy time or times the user can't work out.
- Prefer the user's preferred days and times. Where learned_from_history shows a time or day the user usually misses, avoid it; favour windows they actually complete.
- minutes must be at most max_session_minutes, and all sessions together must stay within weekly_minutes_budget. The budget is set from the user's recent training for gradual progression; never exceed it, even if their goal asks for more.
- minutes must be at most max_session_minutes. Pick exercise ids only from <catalog>, matching the session's category, so their "min" values add up to about the session length. Cardio sessions use one cardio exercise.
- Balance the week across the user's goals and enjoyed formats. Don't put two strength sessions with the same focus on back-to-back days.
- Respect avoid, avoid_notes, limitations and memory notes. Never give medical or rehab advice.
- Be concise: short titles, one-sentence rationales. No filler.`;

export interface PlanResult {
  plan: WeeklyPlan;
  usage?: LlmResult<unknown>["usage"];
  /** Set when the AI couldn't plan and a template plan was used instead. */
  fallback?: string;
}

export async function agentPlanWeek(req: AgentRequest): Promise<PlanResult> {
  const { weekStart, busy, knownRange } = weekContext(req, [], { fresh: true });
  const keep = carryOver(req.plan, weekStart);
  const budget = weeklyLoadBudget({ profile: req.profile, log: req.log, weekStart });
  // This week's profile: session length and count scaled to the progression budget.
  const profile = { ...req.profile, sessionMinutes: budget.sessionMinutes, frequencyPerWeek: budget.sessions };
  const target = Math.max(0, budget.sessions - keep.length);
  const dates = remainingDates(weekStart, req.now.date).filter((d) => !keep.some((k) => k.date === d));
  const filter = filterFromProfile(req.profile);
  const createdAt = new Date().toISOString();

  const user = [
    `Today is ${req.now.date} (${req.now.time}). Plan ${target} session${target === 1 ? "" : "s"} for the 7 days from ${weekStart} to ${addDays(weekStart, 6)}.`,
    `<profile>${JSON.stringify({ ...profileContext(profile), weekly_minutes_budget: budget.planMinutes, progression: budget.reason })}</profile>`,
    `<memory>${JSON.stringify(memoryContext(req))}</memory>`,
    `<days>${JSON.stringify(daysContext(dates, busy, keep, req.now))}</days>`,
    keep.length ? `<already_done_this_week>${JSON.stringify(keep.map((w) => ({ date: w.date, category: w.category, title: w.title })))}</already_done_this_week>` : "",
    `<catalog>${JSON.stringify(catalogFor(filter))}</catalog>`,
  ].join("\n");

  const res = await callTool({ system: SYSTEM, user, name: "propose_week", description: "Propose this week's workouts.", schema: PlanOutput });

  const workouts: Workout[] = [...keep];
  const allowed = new Set(dates);
  for (const [i, s] of res.output.sessions.entries()) {
    if (workouts.length - keep.length >= target) break;
    if (!allowed.has(s.date) || workouts.some((w) => w.date === s.date)) continue;
    const built = assembleWorkout(s, { id: `ai-${weekStart}-${i}-${createdAt.slice(11, 19).replaceAll(":", "")}`, profile, filter });
    const placed = built && repairStart(built, busy, workouts, profile, req.now);
    if (!placed) continue;
    // Gate each addition so one bad session can't sink the whole plan.
    const trial: WeeklyPlan = { id: "trial", weekStart, workouts: [...workouts, placed], generatedBy: "agent", createdAt, notes: [] };
    if (validatePlan(trial, { profile, busy, knownRange, now: req.now, weeklyMinuteCap: budget.planMinutes }).ok) workouts.push(placed);
  }

  const notes = [...res.output.notes];
  const planned = workouts.length - keep.length;
  if (planned < target) {
    notes.push(`Found time for ${planned + keep.length} of your ${req.profile.frequencyPerWeek} workouts this week.`);
  }
  if (budget.planMinutes < req.profile.frequencyPerWeek * req.profile.sessionMinutes) notes.push(budget.reason);

  workouts.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return {
    plan: { id: `plan-${weekStart}`, weekStart, workouts, generatedBy: "agent", createdAt, notes },
    usage: res.usage,
  };
}

/** The template planner, ordered by what past weeks show. Used when AI is off or fails. */
export function templatePlanWeek(req: AgentRequest, reason?: string): PlanResult {
  const weekStart = weekContext(req, [], { fresh: true }).weekStart;
  const budget = weeklyLoadBudget({ profile: req.profile, log: req.log, weekStart });
  const insights = computeInsights({ log: req.log, history: req.history, plan: req.plan, now: req.now });
  const plan = buildSamplePlan({
    profile: { ...req.profile, sessionMinutes: budget.sessionMinutes, frequencyPerWeek: budget.sessions },
    preset: req.calendarPreset,
    now: req.now,
    createdAt: new Date().toISOString(),
    weekStart,
    keep: carryOver(req.plan, weekStart),
    blocked: req.blocked,
    timeOrder: learnedTimeOrder(req.profile.preferredTimes, insights),
  });
  if (budget.planMinutes < req.profile.frequencyPerWeek * req.profile.sessionMinutes) plan.notes.push(budget.reason);
  return { plan, fallback: reason };
}
