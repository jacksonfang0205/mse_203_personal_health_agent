/**
 * Wall-clock date/time helpers. Pivot stores local dates ("YYYY-MM-DD") and
 * times ("HH:MM") without time zones; all date math is done in UTC so the
 * result never depends on where the code runs.
 */
import { IsoDate, WEEKDAYS, type ClockTime, type Weekday } from "./schemas";

export function toMinutes(time: ClockTime): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(total: number): ClockTime {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parse(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

function format(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}

export function weekdayOf(date: IsoDate): Weekday {
  // getUTCDay: 0 = Sunday
  return WEEKDAYS[(parse(date).getUTCDay() + 6) % 7];
}

export function mondayOf(date: IsoDate): IsoDate {
  return addDays(date, -WEEKDAYS.indexOf(weekdayOf(date)));
}

/**
 * Whether a date falls in a plan's 7-day window. A plan starts on the day it
 * was made and runs six more days, so the week always starts from "today".
 */
export function planCovers(plan: { weekStart: IsoDate }, date: IsoDate): boolean {
  return date >= plan.weekStart && date <= addDays(plan.weekStart, 6);
}

export function weekDates(weekStart: IsoDate): IsoDate[] {
  return WEEKDAYS.map((_, i) => addDays(weekStart, i));
}

/** Local "now" from a JS Date, in Pivot's wall-clock format. Client-only. */
export function localNow(d: Date): { date: IsoDate; time: ClockTime } {
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
  return { date, time: fromMinutes(d.getHours() * 60 + d.getMinutes()) };
}

/** Compare two (date, time) moments. Negative if a is earlier. */
export function compareMoments(
  a: { date: IsoDate; time: ClockTime },
  b: { date: IsoDate; time: ClockTime },
): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return toMinutes(a.time) - toMinutes(b.time);
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_SHORT: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};
const DAY_LONG: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export function dayShort(date: IsoDate): string {
  return DAY_SHORT[weekdayOf(date)];
}

export function dayLong(date: IsoDate): string {
  return DAY_LONG[weekdayOf(date)];
}

export function dayOfMonth(date: IsoDate): number {
  return parse(date).getUTCDate();
}

export function monthDay(date: IsoDate): string {
  const d = parse(date);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "7:30 am" */
export function formatTime(time: ClockTime): string {
  const mins = toMinutes(time);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function formatRange(start: ClockTime, durationMin: number): string {
  return `${formatTime(start)} – ${formatTime(fromMinutes(toMinutes(start) + durationMin))}`;
}

/** "Wed, Nov 18": the one date format coach replies and options use. The weekday always comes from the date. */
export function formatDate(date: IsoDate): string {
  return `${dayShort(date)}, ${monthDay(date)}`;
}

const WEEKDAY_WORD =
  "(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)";
const MONTH_WORD = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?";

/**
 * Make model-written text safe to show: ISO dates ("2026-11-18") become
 * "Wed, Nov 18", and a weekday written next to a date is replaced with the
 * real weekday for that date, so "Wednesday, Nov 19" can't slip through when
 * Nov 19 is a Thursday. `year` resolves dates written without one.
 */
export function humanizeDates(text: string, year: number): string {
  const iso = new RegExp(`(?:\\b${WEEKDAY_WORD},?\\s*\\(?)?\\b(\\d{4}-\\d{2}-\\d{2})\\b\\)?`, "g");
  let out = text.replace(iso, (m, d: string) => (IsoDate.safeParse(d).success && !isNaN(Date.parse(`${d}T00:00:00Z`)) ? formatDate(d) : m));
  const named = new RegExp(`\\b${WEEKDAY_WORD},?\\s+\\(?${MONTH_WORD}\\s+(\\d{1,2})\\b\\)?`, "g");
  out = out.replace(named, (m, mon: string, day: string) => {
    const mi = MONTHS.findIndex((x) => x.toLowerCase() === mon.slice(0, 3).toLowerCase());
    const d = Number(day);
    if (mi < 0 || d < 1 || d > 31) return m;
    return formatDate(`${year}-${String(mi + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  });
  return out;
}
