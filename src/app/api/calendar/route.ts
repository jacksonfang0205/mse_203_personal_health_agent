import { connection } from "next/server";
import { auth, authConfigured } from "@/auth";
import { importBusy } from "@/lib/googleCalendar";
import { IsoDate } from "@/lib/schemas";

/**
 * Busy times from the signed-in user's Google Calendar, as one-off blocked times.
 *   GET /api/calendar?start=2026-11-10&days=7&tz=America/Los_Angeles
 */
export async function GET(request: Request) {
  await connection();
  if (!authConfigured()) return Response.json({ error: "Accounts aren't set up." }, { status: 501 });
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Sign in with Google first." }, { status: 401 });
  const url = new URL(request.url);
  const start = IsoDate.safeParse(url.searchParams.get("start"));
  const days = Math.min(14, Math.max(1, Number(url.searchParams.get("days") ?? 7) || 7));
  const tz = url.searchParams.get("tz") ?? "UTC";
  if (!start.success) return Response.json({ error: "start must be YYYY-MM-DD." }, { status: 400 });
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
  } catch {
    return Response.json({ error: "Unknown time zone." }, { status: 400 });
  }
  try {
    return Response.json({ blocked: await importBusy(session.user.id, start.data, days, tz) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
