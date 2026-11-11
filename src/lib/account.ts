"use client";

/**
 * Google Calendar import from the browser. The signed-in account itself lives
 * in <AccountProvider> (src/components/AccountProvider.tsx).
 */
import type { BlockedTime, IsoDate } from "./schemas";
import { pivot } from "./store";

/** Replace previously imported calendar blocks with the next `days` days from Google Calendar. */
export async function importGoogleCalendar(start: IsoDate, days = 7): Promise<number> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const r = await fetch(`/api/calendar?${new URLSearchParams({ start, days: String(days), tz })}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `Import failed (${r.status})`);
  const blocked = data.blocked as BlockedTime[];
  for (const b of pivot.get().blocked) if (b.id.startsWith("gcal-")) pivot.removeBlocked(b.id);
  if (blocked.length) pivot.addBlocked(blocked);
  return blocked.length;
}
