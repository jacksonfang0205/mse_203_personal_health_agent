/**
 * How much free time a day has. Workouts aren't pinned to a time, so the only
 * calendar question is whether the day has a long enough free stretch for the
 * session. Planner, agent and validation all use this one definition.
 */
import type { BusyBlock, ClockTime, IsoDate } from "./schemas";
import { toMinutes } from "./time";

export const DAY_START = "06:00";
export const DAY_END = "22:00";
/** Breathing room around events (getting there, changing). */
export const BUFFER_MIN = 15;
/** Shortest session worth planning. */
export const MIN_SESSION = 15;

/** Free stretches in minutes since midnight, longest first. */
export function freeGaps(date: IsoDate, busy: BusyBlock[], notBefore?: ClockTime): [number, number][] {
  const from = Math.max(toMinutes(DAY_START), notBefore ? toMinutes(notBefore) : 0);
  const end = toMinutes(DAY_END);
  const blocks = busy
    .filter((b) => b.date === date)
    .map((b) => [toMinutes(b.start) - BUFFER_MIN, toMinutes(b.end) + BUFFER_MIN])
    .sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  let cursor = from;
  for (const [s, e] of blocks) {
    if (s > cursor) gaps.push([cursor, Math.min(s, end)]);
    cursor = Math.max(cursor, e);
    if (cursor >= end) break;
  }
  if (end > cursor) gaps.push([cursor, end]);
  return gaps.filter(([s, e]) => e > s).sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
}

/** Longest free stretch on the date, in minutes. Pass `notBefore` for today. */
export function dayCapacity(date: IsoDate, busy: BusyBlock[], notBefore?: ClockTime): number {
  const [best] = freeGaps(date, busy, notBefore);
  return best ? best[1] - best[0] : 0;
}

/** A session length that fits the day: the preferred length, or less on a busy day. 0 = no room. */
export function fitMinutes(preferred: number, capacity: number): number {
  const m = Math.min(preferred, Math.floor(capacity / 5) * 5);
  return m >= MIN_SESSION ? m : 0;
}

export function formatFree(minutes: number): string {
  if (minutes <= 0) return "No free time";
  if (minutes < 60) return `${minutes} min free`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}${m >= 30 ? ".5" : ""}h free`;
}
