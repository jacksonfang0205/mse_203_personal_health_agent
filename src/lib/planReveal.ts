/**
 * The "why" behind a freshly built week, shown once right after onboarding.
 * Every line is derived from the plan and profile, so it never claims more than
 * the plan actually does: if a session had to bend a preference, it says so.
 */
import {
  AVOID_TAG_LABELS,
  CATEGORY_STYLE,
  EQUIPMENT_LABELS,
  GOAL_LABELS,
  TIME_OF_DAY,
} from "./labels";
import { TIMES_OF_DAY } from "./schemas";
import { windowOf } from "./insights";
import type { BusyBlock, FitnessProfile, IsoDate, WeeklyPlan, Workout, WorkoutCategory } from "./schemas";
import { addDays, dayShort, formatTime, weekdayOf } from "./time";

export interface RevealReason {
  key: "schedule" | "goals" | "calendar" | "recovery" | "boundaries";
  title: string;
  body: string;
}

/** "Mon, Wed and Fri" */
export function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function scheduleReason(profile: FitnessProfile, workouts: Workout[]): RevealReason {
  const days = joinAnd(workouts.map((w) => dayShort(w.date)));
  const lengths = [...new Set(workouts.map((w) => w.durationMin))];
  const length = lengths.length === 1 ? `${lengths[0]} min each` : `${Math.min(...lengths)}–${Math.max(...lengths)} min`;
  const offDay = workouts.filter((w) => !profile.preferredDays.includes(weekdayOf(w.date)));
  const offTime = workouts.filter((w) => {
    const win = windowOf(w.start);
    return !win || !profile.preferredTimes.includes(win);
  });
  const windows = joinAnd(
    TIMES_OF_DAY.filter((t) => profile.preferredTimes.includes(t)).map((t) => TIME_OF_DAY[t].label.toLowerCase()),
  );

  let body = `${plural(workouts.length, "workout")} on ${days}, ${length}.`;
  if (!offDay.length && !offTime.length) {
    body += ` All on the days you picked, in your ${windows} window${profile.preferredTimes.length > 1 ? "s" : ""}.`;
  } else {
    const bent = [...new Set([...offDay, ...offTime])].map((w) => `${dayShort(w.date)} at ${formatTime(w.start)}`);
    body += ` ${joinAnd(bent)} ${bent.length === 1 ? "is" : "are"} outside your usual days or times, because nothing else was free.`;
  }
  return { key: "schedule", title: "Fits the week you described", body };
}

function goalsReason(profile: FitnessProfile, workouts: Workout[]): RevealReason {
  const counts = new Map<WorkoutCategory, number>();
  for (const w of workouts) counts.set(w.category, (counts.get(w.category) ?? 0) + 1);
  const mix = joinAnd([...counts].map(([c, n]) => `${n} ${CATEGORY_STYLE[c].label.toLowerCase()}`));
  const goals = joinAnd(profile.goals.map((g) => GOAL_LABELS[g].label.toLowerCase()));
  return {
    key: "goals",
    title: "Built around your goals",
    body:
      counts.size === 1
        ? `${workouts.length === 1 ? "A" : `All ${workouts.length}`} ${CATEGORY_STYLE[workouts[0].category].label.toLowerCase()} session${workouts.length === 1 ? "" : "s"}, because you want to ${goals}.`
        : `A mix of ${mix}, because you want to ${goals}.`,
  };
}

function calendarReason(busy: BusyBlock[], weekStart: IsoDate): RevealReason | null {
  const end = addDays(weekStart, 6);
  const events = busy.filter((b) => b.source !== "blocked" && b.date >= weekStart && b.date <= end);
  if (!events.length) return null;
  return {
    key: "calendar",
    title: "Works around your calendar",
    body: `Planned around ${plural(events.length, "event")} on your calendar this week, so nothing overlaps.`,
  };
}

function recoveryReason(workouts: Workout[]): RevealReason | null {
  const dates = [...new Set(workouts.map((w) => w.date))].sort();
  if (dates.length < 2) return null;
  const backToBack = dates.some((d, i) => i > 0 && addDays(dates[i - 1], 1) === d);
  if (backToBack) return null;
  return {
    key: "recovery",
    title: "Room to recover",
    body: "At least one rest day between workouts, so you come back fresh.",
  };
}

function boundariesReason(profile: FitnessProfile): RevealReason {
  const avoid = profile.avoidTags.map((t) => AVOID_TAG_LABELS[t].label.toLowerCase());
  const gear = profile.equipment.length
    ? `only what you have (${joinAnd(profile.equipment.map((e) => EQUIPMENT_LABELS[e].toLowerCase()))})`
    : "no equipment, just bodyweight";
  return {
    key: "boundaries",
    title: "Stays inside your limits",
    body: `Uses ${gear}${avoid.length ? `, and leaves out ${joinAnd(avoid)}` : ""}.`,
  };
}

export function revealReasons(profile: FitnessProfile, plan: WeeklyPlan, busy: BusyBlock[]): RevealReason[] {
  const workouts = [...plan.workouts].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  if (!workouts.length) return [];
  return [
    scheduleReason(profile, workouts),
    goalsReason(profile, workouts),
    calendarReason(busy, plan.weekStart),
    recoveryReason(workouts),
    boundariesReason(profile),
  ].filter((r): r is RevealReason => r !== null);
}

/** One line about what happens first, so a rest day today doesn't read as an empty plan. */
export function firstUp(plan: WeeklyPlan, today: IsoDate): string {
  const next = [...plan.workouts]
    .filter((w) => w.date >= today && w.status === "planned")
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];
  if (!next) return "No workouts fit this week. Ask your coach below to find time.";
  const when = formatTime(next.start);
  if (next.date === today) return `Your first workout is today at ${when}: ${next.title}.`;
  const day = next.date === addDays(today, 1) ? "tomorrow" : dayShort(next.date);
  return `Today is a rest day. Your first workout is ${day} at ${when}: ${next.title}.`;
}
