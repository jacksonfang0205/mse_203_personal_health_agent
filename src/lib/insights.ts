/**
 * What Pivot has learned from the user's past weeks.
 *
 * Pure and deterministic: computed from the workout log, the current plan, and
 * Life Happens decisions. Workouts have no assigned time, so "time of day" is
 * when the user actually checked a workout off. The agent gets `summary`.
 */
import { CATEGORY_STYLE, TIME_OF_DAY, WEEKDAY_LABELS } from "./labels";
import type {
  AlternativeKind,
  ChangeRecord,
  ClockTime,
  IsoDate,
  TimeOfDay,
  Weekday,
  WeeklyPlan,
  WorkoutCategory,
  WorkoutLogEntry,
} from "./schemas";
import { TIMES_OF_DAY } from "./schemas";
import { toMinutes, weekdayOf } from "./time";

export interface Rate {
  done: number;
  total: number;
}

export interface Insights {
  /** Workouts with a known outcome (done, skipped, or missed). */
  samples: number;
  /** When completed workouts were checked off. */
  doneByWindow: Partial<Record<TimeOfDay, number>>;
  byCategory: Partial<Record<WorkoutCategory, Rate>>;
  byWeekday: Partial<Record<Weekday, Rate>>;
  /** Alternative kinds the user picked in Life Happens. */
  chosenKinds: Partial<Record<AlternativeKind, number>>;
  declined: number;
  /** Plain-language findings, only where there's enough data. */
  summary: string[];
}

const MIN_SAMPLES = 2;

export function windowOf(start: ClockTime): TimeOfDay | null {
  const m = toMinutes(start);
  return TIMES_OF_DAY.find((t) => m >= toMinutes(TIME_OF_DAY[t].start) && m < toMinutes(TIME_OF_DAY[t].end)) ?? null;
}

function bump<K extends string>(rec: Partial<Record<K, Rate>>, key: K, done: boolean) {
  const r = (rec[key] ??= { done: 0, total: 0 });
  r.total++;
  if (done) r.done++;
}

const pct = (r: Rate) => Math.round((r.done / r.total) * 100);

export function computeInsights(args: {
  log: WorkoutLogEntry[];
  history: ChangeRecord[];
  plan: WeeklyPlan | null;
  now: { date: IsoDate; time: ClockTime };
}): Insights {
  const outcomes: { date: IsoDate; category: WorkoutCategory; done: boolean }[] = args.log.map((e) => ({
    ...e,
    done: e.status === "completed",
  }));
  // Planned workouts whose day has passed without being checked off count as missed.
  const logged = new Set(args.log.map((e) => e.workoutId));
  for (const w of args.plan?.workouts ?? []) {
    if (w.status === "planned" && !logged.has(w.id) && w.date < args.now.date) {
      outcomes.push({ date: w.date, category: w.category, done: false });
    }
  }

  const doneByWindow: Insights["doneByWindow"] = {};
  const byCategory: Insights["byCategory"] = {};
  const byWeekday: Insights["byWeekday"] = {};
  for (const o of outcomes) {
    bump(byCategory, o.category, o.done);
    bump(byWeekday, weekdayOf(o.date), o.done);
  }
  for (const e of args.log) {
    const win = e.status === "completed" && e.time ? windowOf(e.time) : null;
    if (win) doneByWindow[win] = (doneByWindow[win] ?? 0) + 1;
  }

  const chosenKinds: Insights["chosenKinds"] = {};
  let declined = 0;
  for (const h of args.history) {
    if (h.decision === "rejected") declined++;
    else if (h.alternativeKind) chosenKinds[h.alternativeKind] = (chosenKinds[h.alternativeKind] ?? 0) + 1;
  }

  const summary: string[] = [];
  const totalDone = Object.values(doneByWindow).reduce((a, b) => a + b, 0);
  const [topWindow, topCount] = (Object.entries(doneByWindow) as [TimeOfDay, number][]).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (topWindow && totalDone >= MIN_SAMPLES && topCount / totalDone >= 0.5) {
    summary.push(`Usually works out in the ${TIME_OF_DAY[topWindow].label.toLowerCase()} (${topCount} of ${totalDone} completed).`);
  }
  const cats = (Object.keys(byCategory) as WorkoutCategory[]).filter((c) => byCategory[c]!.total >= MIN_SAMPLES);
  const weak = cats.filter((c) => pct(byCategory[c]!) < 50);
  if (weak.length) {
    summary.push(`Often skipped or missed: ${weak.map((c) => `${CATEGORY_STYLE[c].label.toLowerCase()} (${pct(byCategory[c]!)}% done)`).join(", ")}.`);
  }
  const days = (Object.keys(byWeekday) as Weekday[]).filter((d) => byWeekday[d]!.total >= MIN_SAMPLES && pct(byWeekday[d]!) < 50);
  if (days.length) {
    summary.push(`Workouts on ${days.map((d) => WEEKDAY_LABELS[d].long).join(" and ")} usually don't happen.`);
  }
  const kinds = (Object.entries(chosenKinds) as [AlternativeKind, number][]).sort((a, b) => b[1] - a[1]);
  if (kinds.length && kinds[0][1] >= MIN_SAMPLES) {
    summary.push(`When plans change, the user most often picks "${kinds[0][0].replace("_", " ")}" (${kinds[0][1]} times).`);
  }
  if (declined >= MIN_SAMPLES) summary.push(`Declined all options ${declined} times.`);

  return { samples: outcomes.length, doneByWindow, byCategory, byWeekday, chosenKinds, declined, summary };
}
