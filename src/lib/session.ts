/**
 * Glue between stored state, the simulated calendar, and the planner.
 * Pure functions: callers pass in the clock so results are reproducible.
 */
import { blockedToBusy, presetProvider, type CalendarPresetId } from "./calendar";
import { generateMockWeek } from "./planner/generate";
import type { BlockedTime, ClockTime, FitnessProfile, IsoDate, TimeOfDay, WeeklyPlan, Workout } from "./schemas";
import { planCovers } from "./time";
import type { ValidationContext } from "./validation";

/** Calendar events plus the user's blocked times. Pivot treats both as busy. */
export function calendarForWeek(preset: CalendarPresetId, weekStart: IsoDate, blocked: BlockedTime[] = []) {
  const provider = presetProvider(preset, weekStart);
  const knownRange = provider.knownRange();
  return { busy: [...provider.getBusySync(knownRange), ...blockedToBusy(blocked, knownRange)], knownRange };
}

/** Completed workouts from an old plan that fall inside a new window, so replanning never drops finished work. */
export function carryOver(plan: WeeklyPlan | null | undefined, weekStart: IsoDate): Workout[] {
  return plan?.workouts.filter((w) => w.status === "completed" && planCovers({ weekStart }, w.date)) ?? [];
}

export function buildSamplePlan(args: {
  profile: FitnessProfile;
  preset: CalendarPresetId;
  now: { date: IsoDate; time: ClockTime };
  createdAt: string;
  keep?: Workout[];
  blocked?: BlockedTime[];
  /** Preferred windows in the order the user actually shows up (from insights). */
  timeOrder?: TimeOfDay[];
  /** First day of the 7-day window. Defaults to today. */
  weekStart?: IsoDate;
}) {
  const weekStart = args.weekStart ?? args.now.date;
  const { busy } = calendarForWeek(args.preset, weekStart, args.blocked);
  return generateMockWeek({
    profile: args.profile,
    weekStart,
    busy,
    now: args.now,
    keep: args.keep,
    createdAt: args.createdAt,
    timeOrder: args.timeOrder,
  });
}

export function validationContextFor(
  profile: FitnessProfile,
  preset: CalendarPresetId,
  weekStart: IsoDate,
  blocked: BlockedTime[] = [],
): ValidationContext {
  const { busy, knownRange } = calendarForWeek(preset, weekStart, blocked);
  return { profile, busy, knownRange };
}
