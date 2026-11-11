import { describe, expect, it } from "vitest";
import { BlockedTime } from "./schemas";
import { eventsToBlocked } from "./googleCalendar";

const at = "2026-11-10T00:00:00.000Z";

describe("Google Calendar import", () => {
  it("turns timed, busy events into one-off blocks with no event titles", () => {
    const out = eventsToBlocked(
      [
        { id: "a", start: { dateTime: "2026-11-10T17:00:00-08:00" }, end: { dateTime: "2026-11-10T19:00:00-08:00" } },
        { id: "free", transparency: "transparent", start: { dateTime: "2026-11-11T09:00:00-08:00" }, end: { dateTime: "2026-11-11T10:00:00-08:00" } },
        { id: "gone", status: "cancelled", start: { dateTime: "2026-11-11T09:00:00-08:00" }, end: { dateTime: "2026-11-11T10:00:00-08:00" } },
        { id: "bday", start: { date: "2026-11-12" }, end: { date: "2026-11-13" } },
      ],
      at,
    );
    expect(out).toEqual([
      { id: "gcal-a-2026-11-10", days: ["tue"], date: "2026-11-10", start: "17:00", end: "19:00", label: "Google Calendar", source: "user", createdAt: at },
    ]);
    for (const b of out) expect(() => BlockedTime.parse(b)).not.toThrow();
  });

  it("splits an event that runs past midnight", () => {
    const out = eventsToBlocked(
      [{ id: "late", start: { dateTime: "2026-11-10T22:00:00-08:00" }, end: { dateTime: "2026-11-11T01:30:00-08:00" } }],
      at,
    );
    expect(out.map((b) => `${b.date} ${b.start}-${b.end}`)).toEqual(["2026-11-10 22:00-23:59", "2026-11-11 00:00-01:30"]);
  });
});
