/** Guardrails on marking workouts done. Shared by the store and the UI. */
import type { IsoDate, Workout } from "./schemas";
import { formatDate } from "./time";

/** Why a workout can't be marked done yet, or null when it can. You can't finish a workout before its day. */
export function doneBlockedReason(w: Pick<Workout, "date">, today: IsoDate): string | null {
  return w.date > today ? `You can mark this done on ${formatDate(w.date)}.` : null;
}
