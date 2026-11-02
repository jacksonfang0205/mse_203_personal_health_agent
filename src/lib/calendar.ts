/**
 * Calendar availability adapter.
 *
 * Everything that needs busy/free information goes through `CalendarProvider`.
 * Phase 1 ships the simulated provider. A Google provider (OAuth + FreeBusy)
 * will implement the same interface later; it must only ever *read* calendars
 * unless the user explicitly confirms a write.
 */
import type { BlockedTime, BusyBlock, ClockTime, IsoDate, Weekday } from "./schemas";
import { addDays, weekdayOf } from "./time";

export interface DateRange {
  /** Inclusive. */
  start: IsoDate;
  /** Inclusive. */
  end: IsoDate;
}

export interface CalendarProvider {
  readonly kind: "simulated" | "google";
  /** Busy blocks within the range. Dates outside `knownRange` are unknown, not free. */
  getBusy(range: DateRange): Promise<BusyBlock[]>;
  /** The range this provider can actually vouch for. */
  knownRange(): DateRange;
}

export interface RecurringBlock {
  weekday: Weekday;
  start: ClockTime;
  end: ClockTime;
  title: string;
}

export function expandRecurring(blocks: RecurringBlock[], range: DateRange): BusyBlock[] {
  const out: BusyBlock[] = [];
  for (let date = range.start; date <= range.end; date = addDays(date, 1)) {
    const wd = weekdayOf(date);
    blocks
      .filter((b) => b.weekday === wd)
      .forEach((b, i) =>
        out.push({ id: `sim-${date}-${i}`, date, start: b.start, end: b.end, title: b.title, source: "simulated" }),
      );
  }
  return out;
}

/** The user's remembered "can't make it" times, as busy blocks within the range. */
export function blockedToBusy(blocked: BlockedTime[], range: DateRange): BusyBlock[] {
  const out: BusyBlock[] = [];
  for (let date = range.start; date <= range.end; date = addDays(date, 1)) {
    const wd = weekdayOf(date);
    for (const b of blocked) {
      if (b.date ? b.date !== date : !b.days.includes(wd)) continue;
      out.push({ id: `blk-${b.id}-${date}`, date, start: b.start, end: b.end, title: b.label || "Unavailable", source: "blocked" });
    }
  }
  return out;
}

export class SimulatedCalendarProvider implements CalendarProvider {
  readonly kind = "simulated" as const;

  constructor(
    private readonly blocks: BusyBlock[],
    private readonly range: DateRange,
  ) {}

  static fromRecurring(recurring: RecurringBlock[], range: DateRange) {
    return new SimulatedCalendarProvider(expandRecurring(recurring, range), range);
  }

  async getBusy(range: DateRange): Promise<BusyBlock[]> {
    return this.getBusySync(range);
  }

  /** Synchronous variant for the client-only prototype and deterministic tests. */
  getBusySync(range: DateRange): BusyBlock[] {
    return this.blocks.filter((b) => b.date >= range.start && b.date <= range.end);
  }

  knownRange(): DateRange {
    return this.range;
  }
}

// ---------- Simulated calendar presets (synthetic) ----------

export const CALENDAR_PRESETS = {
  student: {
    label: "Student week",
    blurb: "Lectures, sections, a part-time shift, and a Friday social",
    blocks: [
      ...(["mon", "wed", "fri"] as const).map((weekday) => ({ weekday, start: "10:30", end: "11:50", title: "Lecture" })),
      ...(["tue", "thu"] as const).map((weekday) => ({ weekday, start: "13:30", end: "15:20", title: "Seminar" })),
      { weekday: "mon", start: "15:00", end: "16:30", title: "Section" },
      { weekday: "wed", start: "17:00", end: "19:00", title: "Campus job" },
      { weekday: "thu", start: "18:00", end: "19:30", title: "Club meeting" },
      { weekday: "fri", start: "19:00", end: "22:00", title: "Dinner with friends" },
      { weekday: "sat", start: "11:00", end: "13:00", title: "Brunch" },
      { weekday: "sun", start: "14:00", end: "18:00", title: "Study block" },
    ] satisfies RecurringBlock[],
  },
  professional: {
    label: "Young professional",
    blurb: "9-to-6 workdays, a standing Thursday dinner, weekend errands",
    blocks: [
      ...(["mon", "tue", "wed", "thu", "fri"] as const).map((weekday) => ({
        weekday,
        start: "09:00",
        end: "18:00",
        title: "Work",
      })),
      { weekday: "tue", start: "07:30", end: "08:15", title: "Team sync (early)" },
      { weekday: "thu", start: "19:00", end: "21:00", title: "Dinner" },
      { weekday: "sat", start: "10:00", end: "12:00", title: "Errands" },
    ] satisfies RecurringBlock[],
  },
  open: {
    label: "Light week",
    blurb: "Very few commitments",
    blocks: [{ weekday: "wed", start: "12:00", end: "13:00", title: "Lunch" }] satisfies RecurringBlock[],
  },
} as const;

export type CalendarPresetId = keyof typeof CALENDAR_PRESETS;
export const CALENDAR_PRESET_IDS = Object.keys(CALENDAR_PRESETS) as CalendarPresetId[];

export function presetProvider(preset: CalendarPresetId, weekStart: IsoDate): SimulatedCalendarProvider {
  return SimulatedCalendarProvider.fromRecurring(CALENDAR_PRESETS[preset].blocks, {
    start: weekStart,
    end: addDays(weekStart, 6),
  });
}
