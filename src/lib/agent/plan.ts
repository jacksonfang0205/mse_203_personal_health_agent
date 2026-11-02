/**
 * Agent weekly planning: the model picks days, lengths, formats and exercises
 * from each day's free time and the user's memory. Workouts have no clock time;
 * the user does them whenever suits them. Deterministic code rebuilds every
 * workout from the catalog, caps it at the day's free time, and keeps only what
 * passes the validation gate.
 */
import { z } from "zod";
import { capacityOn, filterFromProfile } from "../planner/generate";
import { IsoDate, MuscleGroup, WorkoutCategory, type WeeklyPlan, type Workout } from "../schemas";
import { buildSamplePlan } from "../session";
import { validatePlan } from "../validation";
import {
  assembleWorkout,
  catalogFor,
  daysContext,
  memoryContext,
  profileContext,
  remainingDates,
  weekContext,
  type AgentRequest,
} from "./context";
import { callTool, type LlmResult } from "./llm";

const PlanOutput = z.object({
  sessions: z
    .array(
      z.object({
        date: IsoDate,
        category: WorkoutCategory,
        minutes: z.number().describe("at most the day's free_minutes and max_session_minutes"),
        focus: z.array(MuscleGroup),
        title: z.string().describe("2-4 words, e.g. 'Lower body strength'"),
        exerciseIds: z.array(z.string()).describe("ids from <catalog>, in order"),
        rationale: z.string().describe("one sentence, at most 25 words: which goal it serves and why this day"),
      }),
    )
    .max(7),
  notes: z
    .array(z.string())
    .max(2)
    .describe(
      "addressed to the user ('you'), plain language: only goals or preferences this week's plan can't meet. Never mention dates provided, inputs or data, and never count sessions or days left (the app does). Usually empty.",
    ),
});

const SYSTEM = `You are Pivot's planning agent. You plan a week of workouts for one person.
Workouts are assigned to days, not times: the user does each one whenever suits them that day and checks it off.

Rules:
- Schedule exactly the number of sessions asked for, one per day at most, on the dates listed. Skip days that already have a workout.
- minutes must be at most that day's free_minutes (its longest free stretch) and at most max_session_minutes. On a busy day, plan a shorter session rather than none. Skip days with under 15 free minutes.
- Prefer the user's preferred days. Where learned_from_history shows a day or format the user usually misses, avoid it.
- Pick exercise ids only from <catalog>, matching the session's category, so their "min" values add up to about the session length. Cardio sessions use one cardio exercise.
- Balance the week across the user's goals and enjoyed formats. Don't put two strength sessions with the same focus on back-to-back days.
- Respect avoid, avoid_notes, limitations and memory notes. Never give medical or rehab advice.
- Be concise: short titles, one-sentence rationales. Never mention clock times. No filler.`;

export interface PlanResult {
  plan: WeeklyPlan;
  usage?: LlmResult<unknown>["usage"];
  /** Set when the AI couldn't plan and a template plan was used instead. */
  fallback?: string;
}

export async function agentPlanWeek(req: AgentRequest): Promise<PlanResult> {
  const { weekStart, busy, knownRange } = weekContext(req);
  const keep = req.plan?.weekStart === weekStart ? req.plan.workouts.filter((w) => w.status === "completed") : [];
  const target = Math.max(0, req.profile.frequencyPerWeek - keep.length);
  const dates = remainingDates(weekStart, req.now.date).filter((d) => !keep.some((k) => k.date === d));
  const filter = filterFromProfile(req.profile);
  const createdAt = new Date().toISOString();

  const user = [
    `Today is ${req.now.date} (${req.now.time}). Plan ${target} session${target === 1 ? "" : "s"} for the rest of the week starting ${weekStart}.`,
    `<profile>${JSON.stringify(profileContext(req.profile))}</profile>`,
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
    const placed = assembleWorkout(s, {
      id: `ai-${weekStart}-${i}-${createdAt.slice(11, 19).replaceAll(":", "")}`,
      profile: req.profile,
      filter,
      maxMinutes: capacityOn(s.date, busy, req.now),
    });
    if (!placed) continue;
    // Gate each addition so one bad session can't sink the whole plan.
    const trial: WeeklyPlan = { id: "trial", weekStart, workouts: [...workouts, placed], generatedBy: "agent", createdAt, notes: [] };
    if (validatePlan(trial, { profile: req.profile, busy, knownRange, now: req.now }).ok) workouts.push(placed);
  }

  const notes = [...res.output.notes];
  const planned = workouts.length - keep.length;
  if (planned < target) {
    const total = planned + keep.length;
    notes.unshift(
      dates.length < target
        ? `Only ${dates.length} day${dates.length === 1 ? "" : "s"} left this week, so this plan has ${total} of your ${req.profile.frequencyPerWeek} workouts.`
        : `Found room for ${total} of your ${req.profile.frequencyPerWeek} workouts this week. The other days are too full.`,
    );
  }

  workouts.sort((a, b) => a.date.localeCompare(b.date));
  return {
    plan: { id: `plan-${weekStart}`, weekStart, workouts, generatedBy: "agent", createdAt, notes },
    usage: res.usage,
  };
}

/** The template planner. Used when AI is off or fails. */
export function templatePlanWeek(req: AgentRequest, reason?: string): PlanResult {
  const weekStart = weekContext(req).weekStart;
  const plan = buildSamplePlan({
    profile: req.profile,
    preset: req.calendarPreset,
    now: req.now,
    createdAt: new Date().toISOString(),
    keep: req.plan?.weekStart === weekStart ? req.plan.workouts.filter((w) => w.status === "completed") : [],
    blocked: req.blocked,
  });
  return { plan, fallback: reason };
}
