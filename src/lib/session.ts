/**
 * Glue between stored state, the simulated calendar, and the planner.
 * Pure functions: callers pass in the clock so results are reproducible.
 */
import { presetProvider, type CalendarPresetId } from "./calendar";
import { generateMockWeek } from "./planner/generate";
import type { ClockTime, FitnessProfile, IsoDate, Workout } from "./schemas";
import { mondayOf } from "./time";
import type { ValidationContext } from "./validation";

export function calendarForWeek(preset: CalendarPresetId, weekStart: IsoDate) {
  const provider = presetProvider(preset, weekStart);
  const knownRange = provider.knownRange();
  return { busy: provider.getBusySync(knownRange), knownRange };
}

export function buildSamplePlan(args: {
  profile: FitnessProfile;
  preset: CalendarPresetId;
  now: { date: IsoDate; time: ClockTime };
  createdAt: string;
  keep?: Workout[];
}) {
  const weekStart = mondayOf(args.now.date);
  const { busy } = calendarForWeek(args.preset, weekStart);
  return generateMockWeek({
    profile: args.profile,
    weekStart,
    busy,
    now: args.now,
    keep: args.keep,
    createdAt: args.createdAt,
  });
}

export function validationContextFor(
  profile: FitnessProfile,
  preset: CalendarPresetId,
  weekStart: IsoDate,
): ValidationContext {
  const { busy, knownRange } = calendarForWeek(preset, weekStart);
  return { profile, busy, knownRange };
}
