/**
 * Option text generated from the operations an option actually applies, so
 * what the coach says always matches what changes: same days (weekday
 * derived from the date in code), same times, same lengths. Model-written
 * titles and tradeoffs are only kept when they agree with those facts.
 */
import { TIME_OF_DAY } from "../labels";
import { TIMES_OF_DAY, type Alternative, type AlternativeKind, type PlanOperation, type PreferenceRuleName, type WeeklyPlan, type Workout } from "../schemas";
import { dayLong, formatDate, formatTime, humanizeDates, toMinutes } from "../time";
import { assessChange, type ValidationContext, type Violation } from "../validation";
import { applyOperations } from "./alternatives";

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** One plain sentence per operation, from the workouts before and after. */
export function describeOperation(plan: WeeklyPlan, op: PlanOperation): string {
  if (op.op === "add") {
    const w = op.workout;
    return `Add ${w.title} on ${formatDate(w.date)} at ${formatTime(w.start)}, ${w.durationMin} min.`;
  }
  const before = plan.workouts.find((w) => w.id === op.workoutId);
  const title = before?.title ?? "the workout";
  if (op.op === "skip") return `Skip ${title}${before ? ` on ${formatDate(before.date)}` : ""}. No make-up session.`;
  if (op.op === "move") {
    const mins = before ? `, ${before.durationMin} min` : "";
    return `Move ${title} to ${formatDate(op.date)} at ${formatTime(op.start)}${mins}.`;
  }
  const after = op.workout;
  const when = `${formatDate(after.date)} at ${formatTime(after.start)}, ${after.durationMin} min`;
  if (before && before.title === after.title && before.category === after.category) {
    return `${after.title} on ${when}.`;
  }
  // An addition to the same session ("Upper body strength + lower-body mobility") reads as one.
  if (before && after.title.startsWith(`${before.title} `)) {
    return `${before.title} on ${when}: ${after.title.slice(before.title.length).trim().replace(/^\+\s*/, "adds ").replace(/^\((.*)\)$/, "$1")}.`;
  }
  return `${before ? `Swap ${title} for ` : ""}${before ? lower(after.title) : after.title} on ${when}.`;
}

export function describeOperations(plan: WeeklyPlan, ops: PlanOperation[]): string {
  return ops.map((op) => describeOperation(plan, op)).join(" ");
}

/** A short title for an option, from its first operation. */
export function generatedTitle(kind: AlternativeKind, plan: WeeklyPlan, ops: PlanOperation[]): string {
  const op = ops[0];
  if (op.op === "skip") return "Skip it and rest";
  if (op.op === "move") return `Move to ${formatDate(op.date)}`;
  const w = op.workout;
  if (kind === "shorter") return `${w.durationMin}-minute version`;
  if (kind === "swap_format") return `Switch to ${lower(w.title)}`;
  return `${w.title}, ${formatDate(w.date)}`;
}

// ---------- checking model text against the facts ----------

const WEEKDAY_RE = /\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?\b/gi;
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/gi;
const MINUTES_RE = /\b(\d{1,3})\s*[- ]?(?:min|mins|minute|minutes)\b/gi;
const ISO_RE = /\b\d{4}-\d{2}-\d{2}\b/g;

const dayKey = (date: string) => dayLong(date).slice(0, 3).toLowerCase();

function factsOf(plan: WeeklyPlan, ops: PlanOperation[]) {
  const next = applyOperations(plan, ops);
  const ids = new Set(ops.map((o) => (o.op === "add" ? o.workout.id : o.workoutId)));
  const before: Workout[] = plan.workouts.filter((w) => ids.has(w.id));
  // Skipped workouts don't move anywhere, so they add nothing new to mention.
  const after: Workout[] = next.workouts.filter((w) => ids.has(w.id) && w.status !== "skipped");
  const fact = <T,>(f: (w: Workout) => T) => {
    const old = new Set(before.map(f));
    const now = new Set(after.map(f));
    return { all: new Set([...old, ...now]), fresh: new Set([...now].filter((x) => !old.has(x))) };
  };
  return { days: fact((w) => dayKey(w.date)), times: fact((w) => toMinutes(w.start)), minutes: fact((w) => w.durationMin), dates: fact((w) => w.date) };
}

/** Every mention is a real fact of the option, and if the option changes that fact, the new value is mentioned. */
function consistent(mentioned: (string | number)[], f: { all: Set<string | number>; fresh: Set<string | number> }) {
  if (!mentioned.length) return true;
  if (!mentioned.every((m) => f.all.has(m))) return false;
  return !f.fresh.size || mentioned.some((m) => f.fresh.has(m));
}

/**
 * True when the weekdays, dates, clock times and session lengths mentioned in
 * `text` belong to the workouts this option touches, and, where the option
 * changes one of them, the text names the new value ("Quick Wednesday
 * session" fails for a session that moves to Sunday).
 */
export function textMatchesOperations(text: string, plan: WeeklyPlan, ops: PlanOperation[]): boolean {
  const f = factsOf(plan, ops);
  const days = [...text.matchAll(WEEKDAY_RE)].map((m) => m[1].slice(0, 3).toLowerCase());
  const dates = [...text.matchAll(ISO_RE)].map((m) => m[0]);
  const times = [...text.matchAll(TIME_RE)].map((m) => {
    if (!m[3]) return Number(m[4]) * 60 + Number(m[5]);
    return ((Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0)) * 60 + Number(m[2] ?? 0);
  });
  const minutes = [...text.matchAll(MINUTES_RE)].map((m) => Number(m[1]));
  return consistent(days, f.days) && consistent(dates, f.dates) && consistent(times, f.times) && consistent(minutes, f.minutes);
}

/** Model text that claims a fit the validator didn't grant. */
const CLAIMS_FIT = /\b(fits?|perfect(ly)?|no (conflicts?|changes?)|same (time|day|length))\b/i;

// ---------- bends ----------

/** The named window a start time falls in ("midday"), or the clock time. */
function windowName(start: string): string {
  const t = TIMES_OF_DAY.find((x) => toMinutes(start) >= toMinutes(TIME_OF_DAY[x].start) && toMinutes(start) < toMinutes(TIME_OF_DAY[x].end));
  return t ? TIME_OF_DAY[t].label.toLowerCase() : formatTime(start);
}

/**
 * The question for an option that has to bend a locked preference, built
 * from the workout it produces: "Only midday is free, 25 min. OK?"
 */
export function bendQuestion(bends: Violation[], next: WeeklyPlan): string {
  const byWorkout = new Map<string, Set<string>>();
  for (const b of bends) {
    const id = b.workoutId ?? "";
    byWorkout.set(id, (byWorkout.get(id) ?? new Set()).add(b.constraint));
  }
  const parts = [...byWorkout].map(([id, rules]) => {
    const w = next.workouts.find((x) => x.id === id);
    if (!w) return "This changes one of your usual choices";
    const day = rules.has("training_days");
    const time = rules.has("time_windows");
    const where = day && time ? `${dayLong(w.date)} ${windowName(w.start)}` : day ? dayLong(w.date) : time ? windowName(w.start) : "";
    const len = rules.has("session_length") ? `${w.durationMin} min` : "";
    if (where && len) return `Only ${where} is free, ${len}`;
    if (where) return `Only ${where} is free`;
    return `Only ${len} fits`;
  });
  return `${parts.join("; ")}. OK?`;
}

/**
 * Turn a candidate into what the user sees: dropped if it breaks a hard rule,
 * badged "fits" only when the validator says so, or marked "bends" with a
 * question when a locked preference has to give. Text comes from the
 * operations; model text survives only when it matches them.
 */
export function finalizeAlternative(
  plan: WeeklyPlan,
  alt: Omit<Alternative, "fit" | "bends" | "ask">,
  ctx: ValidationContext,
): Alternative | null {
  const next = applyOperations(plan, alt.operations);
  const verdict = assessChange(next, ctx);
  if (verdict.status === "invalid") return null;
  const year = Number(plan.weekStart.slice(0, 4));
  const keep = (t: string) => textMatchesOperations(t, plan, alt.operations) && (verdict.status === "fits" || !CLAIMS_FIT.test(t));
  const tradeoffs = alt.tradeoffs.map((t) => humanizeDates(t, year)).filter(keep);
  const bends = [...new Set(verdict.bends.map((b) => b.constraint as PreferenceRuleName))];
  return {
    ...alt,
    title: keep(alt.title) ? humanizeDates(alt.title, year) : generatedTitle(alt.kind, plan, alt.operations),
    summary: describeOperations(plan, alt.operations),
    tradeoffs: tradeoffs.length ? tradeoffs : ["No major downside."],
    fit: verdict.status === "fits" ? "fits" : "bends",
    ...(bends.length ? { bends, ask: bendQuestion(verdict.bends, next) } : {}),
  };
}

/** Options that fit come first; bending ones after. */
export const fitsFirst = (a: Alternative, b: Alternative) => (a.fit === "fits" ? 0 : 1) - (b.fit === "fits" ? 0 : 1);
