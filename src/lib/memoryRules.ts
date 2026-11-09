/**
 * Rule-based memory from a Life Happens message, used when the AI is off (or
 * missed it). It only catches lasting day changes like "I can't do Wednesdays
 * anymore" and suggests remembering those days as unavailable. The user still
 * approves every suggestion before it's saved.
 */
import { WEEKDAYS, type BlockedTime, type Weekday } from "./schemas";

/** A whole-day block covers Pivot's planning day (6 am–10 pm). */
export const ALL_DAY = { start: "06:00", end: "22:00" } as const;

export function isAllDay(b: Pick<BlockedTime, "start" | "end">): boolean {
  return b.start <= ALL_DAY.start && b.end >= ALL_DAY.end;
}

const DAY_WORDS: Record<Weekday, RegExp> = {
  mon: /\bmon(day)?s?\b/,
  tue: /\btue(s|sday)?s?\b/,
  wed: /\bwed(nesday)?s?\b/,
  thu: /\bthu(r|rs|rsday)?s?\b/,
  fri: /\bfri(day)?s?\b/,
  sat: /\bsat(urday)?s?\b/,
  sun: /\bsun(day)?s?\b/,
};

const UNAVAILABLE = /\b(can'?t|cannot|can not|won'?t be able|unavailable|not available|no longer|never|busy)\b/;
// Words that make it a standing change, not a one-off.
const LASTING =
  /\b(anymore|any more|no longer|never|every|from now on|this semester|this quarter|going forward|each)\b|\b(mon|tues|wednes|thurs|fri|satur|sun)days\b/;

// A specific time of day ("Tuesday evenings", "after 6 pm") isn't a whole day; leave those to the AI or the user.
const PART_OF_DAY = /\b(morning|afternoon|evening|night|lunch|\d{1,2}(:\d\d)?\s?(am|pm))s?\b/;

export function rememberFromMessage(message: string, existing: BlockedTime[], at = new Date().toISOString()): BlockedTime[] {
  const text = message.toLowerCase().replace(/’/g, "'");
  if (!UNAVAILABLE.test(text) || !LASTING.test(text) || PART_OF_DAY.test(text)) return [];
  const days = WEEKDAYS.filter((d) => DAY_WORDS[d].test(text));
  const fresh = days.filter((d) => !existing.some((b) => !b.date && isAllDay(b) && b.days.includes(d)));
  if (!fresh.length) return [];
  return [
    {
      id: crypto.randomUUID(),
      days: fresh,
      ...ALL_DAY,
      label: message.trim().slice(0, 80),
      source: "agent",
      createdAt: at,
    },
  ];
}
