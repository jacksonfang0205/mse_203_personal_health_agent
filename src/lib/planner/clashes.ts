/**
 * Move planned workouts that now clash with busy time (e.g. right after a
 * Google Calendar import). Only the clashing workouts move: first to another
 * free time the same day, then to the nearest free day in the plan's week.
 * Completed, skipped and past workouts are never touched.
 */
import type { BusyBlock, ClockTime, FitnessProfile, IsoDate, WeeklyPlan, Workout } from "../schemas";
import { addDays, overlaps, planCovers, toMinutes } from "../time";
import { findSlotWithFallback } from "./generate";

export interface MovedWorkout {
  id: string;
  title: string;
  from: { date: IsoDate; start: ClockTime };
  to: { date: IsoDate; start: ClockTime };
}

export interface ClashResult {
  plan: WeeklyPlan;
  moved: MovedWorkout[];
  /** Clashing workouts with no free time left this week. */
  unresolved: Workout[];
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

  for (const w of findClashes(args.plan, busy, now)) {
    const others = () => workouts.filter((x) => x.id !== w.id && x.status !== "skipped");
    const dayFree = (date: IsoDate) => !others().some((x) => x.date === date);
    // Same day first, then the nearest days after it, then the nearest before it (never in the past).
    const candidates: IsoDate[] = [w.date];
    for (let i = 1; i <= 6; i++) candidates.push(addDays(w.date, i), addDays(w.date, -i));
    let placed: { date: IsoDate; start: ClockTime } | null = null;
    for (const date of candidates) {
      if (!planCovers(args.plan, date) || date < now.date) continue;
      if (date !== w.date && !dayFree(date)) continue;
      const slot = findSlotWithFallback(
        { date, minutes: w.durationMin, busy, taken: others(), notBefore: now },
        profile.preferredTimes,
      );
      if (slot) {
        placed = { date, start: slot.start };
        break;
      }
    }
    if (!placed) {
      unresolved.push(w);
      continue;
    }
    moved.push({ id: w.id, title: w.title, from: { date: w.date, start: w.start }, to: placed });
    workouts = workouts.map((x) => (x.id === w.id ? { ...x, date: placed.date, start: placed.start } : x));
  }

  return { plan: { ...args.plan, workouts }, moved, unresolved };
}
