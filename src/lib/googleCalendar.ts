/**
 * Google Calendar import, server-side only. Reads the user's primary calendar
 * with the read-only scope and turns timed, busy events into one-off
 * "can't work out" blocks, the same memory the planner already respects.
 * Event titles are dropped: only times are stored.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import type { BlockedTime, IsoDate } from "./schemas";
import { addDays, weekdayOf } from "./time";

/** Ids of imported blocks start with this, so a re-import replaces them. */
export const CALENDAR_BLOCK_PREFIX = "gcal-";
export const CALENDAR_LABEL = "Google Calendar";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

/** The user signed in without granting calendar access; the client asks for it and retries. */
export class CalendarScopeMissing extends Error {}

export interface CalendarEvent {
  id: string;
  status?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

const clock = (dateTime: string) => dateTime.slice(11, 16);

/**
 * Convert events (times already in the user's time zone, as Google returns them
 * when asked for one) into one-off blocked times. Skips all-day, cancelled and
 * "free" events, and splits events that run past midnight.
 */
export function eventsToBlocked(events: CalendarEvent[], createdAt: string): BlockedTime[] {
  const out: BlockedTime[] = [];
  for (const e of events) {
    if (e.status === "cancelled" || e.transparency === "transparent") continue;
    const start = e.start?.dateTime;
    const end = e.end?.dateTime;
    if (!start || !end) continue; // all-day events (birthdays, holidays) don't block workouts
    const startDate = start.slice(0, 10) as IsoDate;
    const endDate = end.slice(0, 10) as IsoDate;
    for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
      const from = d === startDate ? clock(start) : "00:00";
      const to = d === endDate ? clock(end) : "23:59";
      if (from >= to) continue;
      out.push({ id: `${CALENDAR_BLOCK_PREFIX}${e.id}-${d}`, days: [weekdayOf(d)], date: d, start: from, end: to, label: CALENDAR_LABEL, source: "user", createdAt });
    }
  }
  return out;
}

/** The user's Google access token, refreshed and saved if it has expired. */
export async function googleAccessToken(userId: string): Promise<string> {
  const [account] = await db()
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")));
  if (!account?.access_token) throw new Error("No Google account linked. Sign in with Google again.");
  if (!account.scope?.split(" ").includes(CALENDAR_SCOPE)) throw new CalendarScopeMissing("Calendar access hasn't been granted yet.");
  const fresh = account.expires_at && account.expires_at * 1000 > Date.now() + 60_000;
  if (fresh) return account.access_token;
  if (!account.refresh_token) throw new Error("Google access expired. Sign in with Google again.");

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: process.env.AUTH_GOOGLE_ID!,
      client_secret: process.env.AUTH_GOOGLE_SECRET!,
      grant_type: "refresh_token",
      refresh_token: account.refresh_token,
    }),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) throw new Error("Couldn't refresh Google access. Sign in with Google again.");
  await db()
    .update(accounts)
    .set({
      access_token: t.access_token,
      expires_at: Math.floor(Date.now() / 1000 + (t.expires_in ?? 3600)),
      refresh_token: t.refresh_token ?? account.refresh_token,
    })
    .where(and(eq(accounts.provider, "google"), eq(accounts.providerAccountId, account.providerAccountId)));
  return t.access_token;
}

/** Busy times from the primary calendar for `days` days starting at `start` (local dates in `timeZone`). */
export async function importBusy(userId: string, start: IsoDate, days: number, timeZone: string): Promise<BlockedTime[]> {
  const token = await googleAccessToken(userId);
  const end = addDays(start, days);
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
    timeZone,
    // A day of margin on each side; the dates are filtered below in the user's own zone.
    timeMin: new Date(`${addDays(start, -1)}T00:00:00Z`).toISOString(),
    timeMax: new Date(`${addDays(end, 1)}T00:00:00Z`).toISOString(),
  });
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message ?? `Google Calendar error ${r.status}`);
  return eventsToBlocked(data.items ?? [], new Date().toISOString()).filter((b) => b.date! >= start && b.date! < end);
}
