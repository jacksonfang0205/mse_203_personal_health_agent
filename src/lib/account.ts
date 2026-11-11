"use client";

/**
 * Google Calendar import from the browser. The signed-in account itself lives
 * in <AccountProvider> (src/components/AccountProvider.tsx).
 */
import { signIn } from "next-auth/react";
import { resolveClashes, type MovedWorkout } from "./planner/clashes";
import type { BlockedTime, IsoDate, Workout } from "./schemas";
import { calendarForWeek } from "./session";
import { pivot } from "./store";
import { localNow } from "./time";

const CALENDAR_SCOPES = "openid email profile https://www.googleapis.com/auth/calendar.readonly";
/** Preferences reruns the import when it sees this after Google sends the user back. */
export const IMPORT_AFTER_CONSENT = "import=calendar";

/** Ask Google for read-only calendar access (the only time it's requested), then come back and import. */
export function requestCalendarAccess() {
  return signIn(
    "google",
    { redirectTo: `/preferences?${IMPORT_AFTER_CONSENT}` },
    { scope: CALENDAR_SCOPES, access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  );
}

export class NeedsCalendarAccess extends Error {}

export interface ImportResult {
  added: number;
  /** Planned workouts moved because they clashed with the imported times. */
  moved: MovedWorkout[];
  /** Clashing workouts with no free time left this week. */
  unresolved: Workout[];
}

/** Move any planned workouts that clash with the user's busy times (calendar plus blocked times). */
export function fixClashes(): Omit<ImportResult, "added"> {
  const s = pivot.get();
  if (!s.plan || !s.profile) return { moved: [], unresolved: [] };
  const now = localNow(new Date());
  const { busy } = calendarForWeek(s.calendarPreset, s.plan.weekStart, s.blocked);
  const res = resolveClashes({ plan: s.plan, profile: s.profile, busy, now });
  if (res.moved.length) pivot.setPlan(res.plan);
  return { moved: res.moved, unresolved: res.unresolved };
}

/**
 * Replace previously imported calendar blocks with the next `days` days from Google Calendar,
 * then move any workouts in the current plan that now clash.
 */
export async function importGoogleCalendar(start: IsoDate, days = 7): Promise<ImportResult> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const r = await fetch(`/api/calendar?${new URLSearchParams({ start, days: String(days), tz })}`);
  const data = await r.json().catch(() => ({}));
  if (r.status === 403 && data.needsCalendarAccess) throw new NeedsCalendarAccess(data.error);
  if (!r.ok) throw new Error(data.error ?? `Import failed (${r.status})`);
  const blocked = data.blocked as BlockedTime[];
  for (const b of pivot.get().blocked) if (b.id.startsWith("gcal-")) pivot.removeBlocked(b.id);
  if (blocked.length) pivot.addBlocked(blocked);
  return { added: blocked.length, ...fixClashes() };
}
