/**
 * Wall-clock date/time helpers. Pivot stores local dates ("YYYY-MM-DD") and
 * times ("HH:MM") without time zones; all date math is done in UTC so the
 * result never depends on where the code runs.
 */
import { WEEKDAYS, type ClockTime, type IsoDate, type Weekday } from "./schemas";

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
