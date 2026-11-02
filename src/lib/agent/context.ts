/**
 * Shared pieces for the agent routes: the request snapshot the browser sends,
 * the compact context the model sees, and turning the model's session specs
 * into catalog-grounded workouts.
 *
 * The model proposes; this code decides. It only ever sees exercises the user
 * can do, and every workout it describes is rebuilt here from the catalog.
 */
import { z } from "zod";
import { CALENDAR_PRESET_IDS, type CalendarPresetId } from "../calendar";
import { getExercise } from "../catalog";
import { computeInsights } from "../insights";
import { buildWorkout, capacityOn, eligibleExercises, type ExerciseFilter } from "../planner/generate";
import {
  BlockedTime,
  ChangeRecord,
  ClockTime,
  FitnessProfile,
  IsoDate,
  MemoryNote,
  WeeklyPlan,
  WorkoutLogEntry,
  WORKOUT_CATEGORIES,
  type BusyBlock,
  type MuscleGroup,
  type Workout,
  type WorkoutCategory,
} from "../schemas";
import { MIN_SESSION } from "../capacity";
import { calendarForWeek } from "../session";
import { mondayOf, weekDates, weekdayOf } from "../time";

/** Everything the server needs, sent by the browser (the server stores nothing). */
export const AgentRequest = z.object({
  profile: FitnessProfile,
  plan: WeeklyPlan.nullable(),
  history: z.array(ChangeRecord).max(100),
  blocked: z.array(BlockedTime).max(100),
  notes: z.array(MemoryNote).max(50),
  log: z.array(WorkoutLogEntry).max(300),
  calendarPreset: z.enum(CALENDAR_PRESET_IDS as [CalendarPresetId, ...CalendarPresetId[]]),
  now: z.object({ date: IsoDate, time: ClockTime }),
});
export type AgentRequest = z.infer<typeof AgentRequest>;

export function weekContext(req: AgentRequest, extraBusy: BusyBlock[] = []) {
  const weekStart = mondayOf(req.now.date);
  const cal = calendarForWeek(req.calendarPreset, weekStart, req.blocked);
  return { weekStart, busy: [...cal.busy, ...extraBusy], knownRange: cal.knownRange };
}

function prescriptionText(id: string): string {
  const p = getExercise(id)?.prescription;
  if (!p) return "";
  if (p.kind === "reps") return `${p.sets}x${p.reps}`;
  if (p.kind === "hold") return `${p.sets}x${p.seconds}s`;
  return `${p.minutes} min`;
}

/** Only the exercises this user can actually do, grouped by category. */
export function catalogFor(filter: ExerciseFilter) {
  const out: Partial<Record<WorkoutCategory, { id: string; name: string; muscles: MuscleGroup[]; min: number; rx: string }[]>> = {};
  for (const c of WORKOUT_CATEGORIES) {
    const list = eligibleExercises(c, filter).map((e) => ({
      id: e.id,
      name: e.name,
      muscles: e.muscles,
      min: e.minutes,
      rx: prescriptionText(e.id),
    }));
    if (list.length) out[c] = list;
  }
  return out;
}

export function profileContext(p: FitnessProfile) {
  return {
    goals: p.goals,
    experience: p.experience,
    enjoys: p.workoutTypes,
    equipment: p.equipment.length ? p.equipment : ["bodyweight only"],
    max_session_minutes: p.sessionMinutes,
    workouts_per_week: p.frequencyPerWeek,
    preferred_days: p.preferredDays,
    avoid: p.avoidTags,
    avoid_notes: p.avoidNotes || undefined,
    limitations: p.limitations || undefined,
  };
}

/** Memory: remembered constraints, the user's own notes, and what past weeks show. */
export function memoryContext(req: AgentRequest) {
  const insights = computeInsights({ log: req.log, history: req.history, plan: req.plan, now: req.now });
  return {
    notes: req.notes.map((n) => n.text),
    cannot_work_out: req.blocked.map((b) => ({
      when: b.date ?? b.days.join(","),
      time: `${b.start}-${b.end}`,
      label: b.label || undefined,
    })),
    learned_from_history: insights.summary.length ? insights.summary : ["Not enough history yet."],
    recent_changes: req.history.slice(0, 8).map((h) => ({
      said: h.userMessage,
      outcome: h.decision === "accepted" ? `picked ${h.alternativeKind}: ${h.summary}` : "declined all options",
    })),
  };
}

/** Per day: the longest free stretch (the most a session can take) and what's on the calendar. */
export function daysContext(
  dates: IsoDate[],
  busy: BusyBlock[],
  taken: Pick<Workout, "date" | "status" | "title">[],
  now: { date: IsoDate; time: ClockTime },
) {
  return dates.map((date) => ({
    date,
    day: weekdayOf(date),
    free_minutes: capacityOn(date, busy, now),
    already_has_workout: taken.find((t) => t.date === date && t.status !== "skipped")?.title,
    busy: busy.filter((b) => b.date === date).map((b) => `${b.start}-${b.end} ${b.title}`),
  }));
}

export const remainingDates = (weekStart: IsoDate, today: IsoDate) => weekDates(weekStart).filter((d) => d >= today);

// ---------- Session spec → workout ----------

export interface SessionSpec {
  date: IsoDate;
  category: WorkoutCategory;
  minutes: number;
  focus: MuscleGroup[];
  exerciseIds: string[];
  title: string;
  rationale: string;
}

/**
 * Rebuild a model-described session from the catalog. Unknown or ineligible
 * exercise ids are dropped; prescriptions always come from the catalog; the
 * exercise list is trimmed to fit the time. Falls back to the deterministic
 * builder when the model's picks don't leave a usable session.
 */
export function assembleWorkout(
  spec: SessionSpec,
  opts: { id: string; profile: FitnessProfile; filter: ExerciseFilter; /** Day's free minutes. */ maxMinutes?: number },
): Workout | null {
  const cap = Math.min(opts.profile.sessionMinutes, opts.maxMinutes ?? Infinity);
  const minutes = Math.min(cap, Math.max(MIN_SESSION, Math.round(spec.minutes / 5) * 5));
  if (minutes < MIN_SESSION) return null;
  const pool = new Map(eligibleExercises(spec.category, opts.filter).map((e) => [e.id, e]));
  const picks = [...new Set(spec.exerciseIds)].map((id) => pool.get(id)).filter((e) => e !== undefined);
  const base = {
    id: opts.id,
    title: spec.title.trim().slice(0, 60) || "Workout",
    date: spec.date,
    durationMin: minutes,
    category: spec.category,
    rationale: spec.rationale.trim().slice(0, 300),
    status: "planned" as const,
    origin: "agent" as const,
  };

  let exercises: Workout["exercises"] = [];
  if (spec.category === "cardio") {
    const main = picks.find((e) => e.prescription.kind === "duration");
    if (main) exercises = [{ exerciseId: main.id, minutes }];
  } else {
    let used = 0;
    for (const e of picks) {
      if (exercises.length >= 6 || used + e.minutes > minutes * 1.1) continue;
      used += e.minutes;
      const p = e.prescription;
      exercises.push(
        p.kind === "duration"
          ? { exerciseId: e.id, minutes: p.minutes }
          : p.kind === "hold"
            ? { exerciseId: e.id, sets: p.sets, seconds: p.seconds }
            : { exerciseId: e.id, sets: p.sets, reps: p.reps },
      );
    }
  }

  if (!exercises.length) {
    const built = buildWorkout({
      category: spec.category,
      focus: spec.focus,
      minutes,
      filter: opts.filter,
      workoutTypes: opts.profile.workoutTypes,
      id: opts.id,
      date: spec.date,
      origin: "agent",
      rationale: base.rationale,
      title: base.title,
    });
    return built;
  }

  const used = exercises.map((we) => getExercise(we.exerciseId)!);
  return {
    ...base,
    muscles: [...new Set(used.flatMap((e) => e.muscles))],
    equipment: [...new Set(used.flatMap((e) => e.equipment))],
    exercises,
  };
}

/** The day has room for this workout and no other (non-skipped) workout. */
export function fitsDay(
  w: Workout,
  busy: BusyBlock[],
  others: Workout[],
  now: { date: IsoDate; time: ClockTime },
): boolean {
  return (
    !others.some((o) => o.id !== w.id && o.date === w.date && o.status !== "skipped") &&
    capacityOn(w.date, busy, now) >= w.durationMin
  );
}
