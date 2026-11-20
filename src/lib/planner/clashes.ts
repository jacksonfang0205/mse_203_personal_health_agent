/**
 * Move planned workouts that now clash with busy time (e.g. right after a
 * Google Calendar import). Only the clashing workouts move: first to another
 * free time the same day, then to the nearest free day in the plan's week.
 * Completed, skipped and past workouts are never touched.
 */
import { TIMES_OF_DAY, type BusyBlock, type ClockTime, type FitnessProfile, type IsoDate, type WeeklyPlan, type Workout } from "../schemas";
import { addDays, overlaps, planCovers, toMinutes, weekdayOf } from "../time";
import { checkPreferences } from "../validation";
import { bendQuestion } from "./describe";
import { findSlot, findSlotWithFallback } from "./generate";

export interface MovedWorkout {
  id: string;
  title: string;
  from: { date: IsoDate; start: ClockTime };
  to: { date: IsoDate; start: ClockTime };
}

/** A move that only works by bending a locked preference; applied only if the user taps OK. */
export interface BendingMove extends MovedWorkout {
  ask: string;
}

export interface ClashResult {
  plan: WeeklyPlan;
  moved: MovedWorkout[];
  /** Clashing workouts with no free time left this week. */
  unresolved: Workout[];
  /** Clashing workouts whose only free time is off the user's days, times or length. Not applied. */
  needsOk: BendingMove[];
}

export function clashesWithBusy(w: Pick<Workout, "date" | "start" | "durationMin">, busy: BusyBlock[]): boolean {
  const s = toMinutes(w.start);
  return busy.some((b) => b.date === w.date && overlaps(s, s + w.durationMin, toMinutes(b.start), toMinutes(b.end)));
}

const isUpcoming = (w: Workout, now: { date: IsoDate; time: ClockTime }) =>
  w.status === "planned" && (w.date > now.date || (w.date === now.date && w.start > now.time));

export function findClashes(plan: WeeklyPlan, busy: BusyBlock[], now: { date: IsoDate; time: ClockTime }): Workout[] {
  return plan.workouts.filter((w) => isUpcoming(w, now) && clashesWithBusy(w, busy));
}

export function resolveClashes(args: {
  plan: WeeklyPlan;
  profile: FitnessProfile;
  busy: BusyBlock[];
  now: { date: IsoDate; time: ClockTime };
}): ClashResult {
  const { profile, busy, now } = args;
  let workouts = [...args.plan.workouts];
  const moved: MovedWorkout[] = [];
  const unresolved: Workout[] = [];
  const needsOk: BendingMove[] = [];
  const windows = TIMES_OF_DAY.filter((t) => profile.preferredTimes.includes(t));

  for (const w of findClashes(args.plan, busy, now)) {
    const others = () => workouts.filter((x) => x.id !== w.id && x.status !== "skipped");
    const dayFree = (date: IsoDate) => !others().some((x) => x.date === date);
    // Same day first, then the nearest days after it, then the nearest before it (never in the past).
    const candidates: IsoDate[] = [w.date];
    for (let i = 1; i <= 6; i++) candidates.push(addDays(w.date, i), addDays(w.date, -i));
    const open = candidates.filter((date) => planCovers(args.plan, date) && date >= now.date && (date === w.date || dayFree(date)));
    const query = (date: IsoDate) => ({ date, minutes: w.durationMin, busy, taken: others(), notBefore: now });
    // Days, time windows and length are locked: a training day in a chosen window first.
    let placed: { date: IsoDate; start: ClockTime } | null = null;
    for (const date of open.filter((d) => profile.preferredDays.includes(weekdayOf(d)))) {
      const start = findSlot({ ...query(date), windows });
      if (start) {
        placed = { date, start };
        break;
      }
    }
    if (!placed) {
      // Anything else bends a preference: offer it with a question, don't apply it.
      for (const date of open) {
        const slot = findSlotWithFallback(query(date), profile.preferredTimes);
        if (!slot) continue;
        const trial = { ...args.plan, workouts: workouts.map((x) => (x.id === w.id ? { ...x, date, start: slot.start } : x)) };
        const bends = checkPreferences(trial, { profile, busy, knownRange: { start: date, end: date }, previousPlan: args.plan }).filter(
          (v) => v.workoutId === w.id,
        );
        needsOk.push({ id: w.id, title: w.title, from: { date: w.date, start: w.start }, to: { date, start: slot.start }, ask: bendQuestion(bends, trial) });
        break;
      }
      if (!needsOk.some((m) => m.id === w.id)) unresolved.push(w);
      continue;
    }
    moved.push({ id: w.id, title: w.title, from: { date: w.date, start: w.start }, to: placed });
    workouts = workouts.map((x) => (x.id === w.id ? { ...x, date: placed.date, start: placed.start } : x));
  }

  return { plan: { ...args.plan, workouts }, moved, unresolved, needsOk };
}
