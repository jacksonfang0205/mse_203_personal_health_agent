/**
 * The shape of everything Pivot stores for one user. Shared by the browser
 * store (localStorage) and the server (the user_state table), so both validate
 * with the same schema.
 */
import { z } from "zod";
import { CALENDAR_PRESET_IDS, type CalendarPresetId } from "./calendar";
import { BlockedTime, ChangeRecord, FitnessProfile, MemoryNote, WeeklyPlan, WorkoutLogEntry } from "./schemas";

export const AppState = z.object({
  version: z.literal(1),
  profile: FitnessProfile.nullable(),
  plan: WeeklyPlan.nullable(),
  history: z.array(ChangeRecord),
  calendarPreset: z.enum(CALENDAR_PRESET_IDS as [CalendarPresetId, ...CalendarPresetId[]]),
  // Memory. Defaults keep state saved before these fields existed valid.
  blocked: z.array(BlockedTime).default([]),
  notes: z.array(MemoryNote).default([]),
  log: z.array(WorkoutLogEntry).default([]),
  /** Sets ticked off on the Today view: workout id → sets done per exercise, by index. */
  ticks: z.record(z.string(), z.array(z.number().int().min(0))).default({}),
});
export type AppState = z.infer<typeof AppState>;
