"use client";

/**
 * Google Calendar import from the browser. The signed-in account itself lives
 * in <AccountProvider> (src/components/AccountProvider.tsx).
 */
import { signIn } from "next-auth/react";
import type { BlockedTime, IsoDate } from "./schemas";
import { pivot } from "./store";

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

/** Replace previously imported calendar blocks with the next `days` days from Google Calendar. */
export async function importGoogleCalendar(start: IsoDate, days = 7): Promise<number> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const r = await fetch(`/api/calendar?${new URLSearchParams({ start, days: String(days), tz })}`);
  const data = await r.json().catch(() => ({}));
  if (r.status === 403 && data.needsCalendarAccess) throw new NeedsCalendarAccess(data.error);
  if (!r.ok) throw new Error(data.error ?? `Import failed (${r.status})`);
  const blocked = data.blocked as BlockedTime[];
  for (const b of pivot.get().blocked) if (b.id.startsWith("gcal-")) pivot.removeBlocked(b.id);
  if (blocked.length) pivot.addBlocked(blocked);
  return blocked.length;
}
