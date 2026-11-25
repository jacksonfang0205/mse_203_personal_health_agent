import type { ClockTime, IsoDate, Workout } from "../schemas";
import { dayLong, dayShort } from "../time";
import { windowLabelFor } from "./generate";

// "Placed in your free morning on Wednesday" — the planner's own wording for where a workout sits.
const PLACED = /(Placed in your free )([a-z ]+?)( on )([A-Z][a-z]+day)/;

/** The "Placed in your free … on …" sentence, told for the workout's current day and time. */
export function rationaleFor(w: Pick<Workout, "rationale" | "date" | "start">): string {
  return w.rationale.replace(PLACED, (_m, a, _win, b) => `${a}${windowLabelFor(w.start)}${b}${dayLong(w.date)}`);
}

function swapWord(text: string, from: string, to: string): string {
  return from === to ? text : text.replace(new RegExp(`\\b${from}\\b`, "g"), to);
}

/**
 * Move a workout to a new day and time. Its description moves with it, so a
 * Wednesday workout moved to Thursday no longer says "on Wednesday".
 */
export function moveWorkout(w: Workout, date: IsoDate, start: ClockTime): Workout {
  if (w.date === date && w.start === start) return w;
  let rationale = swapWord(w.rationale, dayLong(w.date), dayLong(date));
  rationale = swapWord(rationale, dayShort(w.date), dayShort(date));
  return { ...w, date, start, rationale: rationaleFor({ rationale, date, start }) };
}
