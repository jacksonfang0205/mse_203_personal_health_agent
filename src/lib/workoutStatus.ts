/** Guardrails on marking workouts done. Shared by the store and the UI. */
import type { IsoDate, Workout } from "./schemas";
import { formatDate } from "./time";

/** Why a workout can't be marked done, or null when it can. A workout can only be finished on its own day. */
export function doneBlockedReason(w: Pick<Workout, "date">, today: IsoDate): string | null {
  if (w.date > today) return `You can mark this done on ${formatDate(w.date)}.`;
  if (w.date < today) return "This day has passed, so it can't be marked done now.";
  return null;
}
