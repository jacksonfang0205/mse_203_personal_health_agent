/**
 * Shared pieces for the agent routes: the request snapshot the browser sends,
 * the compact context the model sees, and turning the model's session specs
 * into catalog-grounded workouts.
 *
 * The model proposes; this code decides. It only ever sees exercises the user
 * can do, and every workout it describes is rebuilt here from the catalog.
 */
import { z } from "zod";
import { blockedToBusy, CALENDAR_PRESET_IDS, type CalendarPresetId, type DateRange } from "../calendar";
import { getExercise } from "../catalog";
import { computeInsights } from "../insights";
import { TIME_OF_DAY } from "../labels";
import { buildWorkout, eligibleExercises, findSlotWithFallback, type ExerciseFilter } from "../planner/generate";
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
import { calendarForWeek } from "../session";
import { fromMinutes, mondayOf, overlaps, toMinutes, weekDates, weekdayOf } from "../time";

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
export type AgentRequest = z.infer<typeof AgentRequest> & {
  /**
   * Server-side only (never parsed from a request): use this calendar instead of
   * the preset. The eval harness passes each scenario's persona calendar here.
   */
  calendar?: { busy: BusyBlock[]; knownRange: DateRange };
};

const DAY_START = 6 * 60;
const DAY_END = 22 * 60;
const BUFFER_MIN = 15;

export function weekContext(req: AgentRequest, extraBusy: BusyBlock[] = []) {
  const weekStart = mondayOf(req.now.date);
  const cal = req.calendar
    ? { busy: [...req.calendar.busy, ...blockedToBusy(req.blocked, req.calendar.knownRange)], knownRange: req.calendar.knownRange }
    : calendarForWeek(req.calendarPreset, weekStart, req.blocked);
  return { weekStart, busy: [...cal.busy, ...extraBusy], knownRange: cal.knownRange };
}

/** Free intervals on a date (06:00–22:00, 15 min breathing room around events, not in the past). */
export function freeWindows(
  date: IsoDate,
  busy: BusyBlock[],
  taken: Pick<Workout, "date" | "start" | "durationMin">[],
  now: { date: IsoDate; time: ClockTime },
): string[] {
  if (date < now.date) return [];
  let from = DAY_START;
  if (date === now.date) from = Math.max(from, Math.ceil((toMinutes(now.time) + 30) / 15) * 15);
  const blocks = [
    ...busy.filter((b) => b.date === date).map((b) => [toMinutes(b.start) - BUFFER_MIN, toMinutes(b.end) + BUFFER_MIN]),
    ...taken.filter((t) => t.date === date).map((t) => [toMinutes(t.start), toMinutes(t.start) + t.durationMin]),
  ].sort((a, b) => a[0] - b[0]);
  const out: string[] = [];
  let cursor = from;
  for (const [s, e] of blocks) {
    if (s > cursor && s - cursor >= 15) out.push(`${fromMinutes(cursor)}-${fromMinutes(Math.min(s, DAY_END))}`);
    cursor = Math.max(cursor, e);
    if (cursor >= DAY_END) break;
  }
  if (DAY_END - cursor >= 15) out.push(`${fromMinutes(cursor)}-${fromMinutes(DAY_END)}`);
  return out;
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
    preferred_times: p.preferredTimes.map((t) => `${t} (${TIME_OF_DAY[t].start}-${TIME_OF_DAY[t].end})`),
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

export function daysContext(
  dates: IsoDate[],
  busy: BusyBlock[],
  taken: Pick<Workout, "date" | "start" | "durationMin">[],
  now: { date: IsoDate; time: ClockTime },
) {
  return dates.map((date) => ({
    date,
    day: weekdayOf(date),
    free: freeWindows(date, busy, taken, now),
    busy: busy.filter((b) => b.date === date).map((b) => `${b.start}-${b.end} ${b.title}`),
  }));
}

export const remainingDates = (weekStart: IsoDate, today: IsoDate) => weekDates(weekStart).filter((d) => d >= today);

// ---------- Session spec → workout ----------

export interface SessionSpec {
  date: IsoDate;
  start: ClockTime;
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
  opts: { id: string; profile: FitnessProfile; filter: ExerciseFilter },
): Workout | null {
  const minutes = Math.max(10, Math.min(opts.profile.sessionMinutes, Math.round(spec.minutes / 5) * 5));
  const pool = new Map(eligibleExercises(spec.category, opts.filter).map((e) => [e.id, e]));
  const picks = [...new Set(spec.exerciseIds)].map((id) => pool.get(id)).filter((e) => e !== undefined);
  const base = {
    id: opts.id,
    title: spec.title.trim().slice(0, 60) || "Workout",
    date: spec.date,
    start: spec.start,
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
      start: spec.start,
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

/** True when the workout overlaps busy time (with buffer) or another workout. */
export function conflicts(w: Workout, busy: BusyBlock[], others: Workout[]): boolean {
  const s = toMinutes(w.start);
  const e = s + w.durationMin;
  return (
    e > DAY_END ||
    s < DAY_START ||
    busy.some((b) => b.date === w.date && overlaps(s, e, toMinutes(b.start), toMinutes(b.end))) ||
    others.some((o) => o.date === w.date && o.status !== "skipped" && overlaps(s, e, toMinutes(o.start), toMinutes(o.start) + o.durationMin))
  );
}

/** Keep the model's day but move the start into a real free slot if its time doesn't fit. */
export function repairStart(
  w: Workout,
  busy: BusyBlock[],
  others: Workout[],
  profile: FitnessProfile,
  now: { date: IsoDate; time: ClockTime },
): Workout | null {
  const past = w.date < now.date || (w.date === now.date && w.start <= now.time);
  if (!past && !conflicts(w, busy, others)) return w;
  const slot = findSlotWithFallback(
    { date: w.date, minutes: w.durationMin, busy, taken: others.filter((o) => o.status !== "skipped"), notBefore: now },
    profile.preferredTimes,
  );
  return slot ? { ...w, start: slot.start } : null;
}
