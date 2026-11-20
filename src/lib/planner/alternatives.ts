/**
 * Rule-based "Life Happens" alternatives (Phase 1 preview).
 *
 * It does not read the user's message; it offers up to three options for the
 * next planned workout. Phase 2 replaces the proposal step with the LLM
 * agent, but `applyOperations` and the validation gate stay the same.
 */
import type { DateRange } from "../calendar";
import { CATEGORY_STYLE } from "../labels";
import type {
  Alternative,
  BusyBlock,
  ClockTime,
  FitnessProfile,
  IsoDate,
  PlanOperation,
  Proposal,
  WeeklyPlan,
  Workout,
} from "../schemas";
import { TIMES_OF_DAY } from "../schemas";
import { addDays, dayLong, formatDate, formatTime, weekDates, weekdayOf } from "../time";
import { finalizeAlternative, fitsFirst } from "./describe";
import { allowedCategories, buildWorkout, filterFromProfile, findSlot, findSlotWithFallback } from "./generate";

export function applyOperations(plan: WeeklyPlan, ops: PlanOperation[]): WeeklyPlan {
  let workouts = [...plan.workouts];
  for (const op of ops) {
    switch (op.op) {
      case "move":
        workouts = workouts.map((w) => (w.id === op.workoutId ? { ...w, date: op.date, start: op.start } : w));
        break;
      case "replace":
        workouts = workouts.map((w) => (w.id === op.workoutId ? { ...op.workout, id: op.workoutId } : w));
        break;
      case "skip":
        workouts = workouts.map((w) => (w.id === op.workoutId ? { ...w, status: "skipped" as const } : w));
        break;
      case "add":
        workouts.push(op.workout);
        break;
    }
  }
  workouts.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return { ...plan, workouts };
}

export interface AlternativesArgs {
  plan: WeeklyPlan;
  profile: FitnessProfile;
  busy: BusyBlock[];
  knownRange: DateRange;
  now: { date: IsoDate; time: ClockTime };
  userMessage: string;
  proposalId: string;
  createdAt: string;
}

export function nextPlannedWorkout(plan: WeeklyPlan, now: { date: IsoDate }): Workout | undefined {
  return plan.workouts.find((w) => w.status === "planned" && w.date >= now.date);
}

export function proposeRuleBasedAlternatives(a: AlternativesArgs): Proposal {
  const base = {
    id: a.proposalId,
    createdAt: a.createdAt,
    userMessage: a.userMessage,
    generatedBy: "rule_based_mock" as const,
  };
  const target = nextPlannedWorkout(a.plan, a.now);
  if (!target) {
    return {
      ...base,
      understood: ["Preview mode: Pivot isn't reading your message yet."],
      alternatives: [],
      infeasibleReason: "There are no upcoming planned workouts left this week to adjust.",
    };
  }

  const others = a.plan.workouts.filter((w) => w.id !== target.id && w.status !== "skipped");
  const filter = filterFromProfile(a.profile);
  const candidates: Alternative[] = [];
  const label = `${target.title} on ${formatDate(target.date)}`;

  // 1. Shorter version, same focus.
  const shortMin = target.durationMin > 25 ? 20 : Math.floor(target.durationMin / 2 / 5) * 5;
  if (shortMin >= 10) {
    const slot = findSlotWithFallback(
      { date: target.date, minutes: shortMin, busy: a.busy, taken: others, notBefore: a.now },
      a.profile.preferredTimes,
    );
    const short =
      slot &&
      buildWorkout({
        category: target.category,
        focus: target.muscles,
        minutes: shortMin,
        filter,
        workoutTypes: a.profile.workoutTypes,
        id: target.id,
        date: target.date,
        start: slot.start,
        origin: "rule_based",
        title: `Quick ${target.title.toLowerCase()}`,
        rationale: `A shorter take on ${target.title.toLowerCase()} that keeps the same focus.`,
      });
    if (short) {
      candidates.push({
        id: `${a.proposalId}-shorter`,
        kind: "shorter",
        title: `${shortMin}-minute version`,
        summary: `Keep ${formatDate(target.date)}, but do a ${shortMin}-min ${CATEGORY_STYLE[target.category].label.toLowerCase()} session at ${formatTime(short.start)}.`,
        tradeoffs: [
          `About ${Math.round((shortMin / target.durationMin) * 100)}% of the planned time, so less total work. It keeps the habit going but isn't a full substitute.`,
        ],
        operations: [{ op: "replace", workoutId: target.id, workout: short }],
      });
    }
  }

  // 2. Same workout, another day.
  const days = weekDates(a.plan.weekStart).filter(
    (d) => d >= a.now.date && d !== target.date && !others.some((w) => w.date === d),
  );
  const ranked = [
    ...days.filter((d) => a.profile.preferredDays.includes(weekdayOf(d))),
    ...days.filter((d) => !a.profile.preferredDays.includes(weekdayOf(d))),
  ];
  // A training day and time window first; anything else is a bend the user has to OK.
  const windows = TIMES_OF_DAY.filter((t) => a.profile.preferredTimes.includes(t));
  const strict = ranked
    .filter((d) => a.profile.preferredDays.includes(weekdayOf(d)))
    .map((date) => {
      const start = findSlot({ date, minutes: target.durationMin, busy: a.busy, taken: others, notBefore: a.now, windows });
      return start ? { date, slot: { start, preferred: true } } : null;
    })
    .find((x) => x !== null);
  const loose = ranked
    .map((date) => {
      const slot = findSlotWithFallback(
        { date, minutes: target.durationMin, busy: a.busy, taken: others, notBefore: a.now },
        a.profile.preferredTimes,
      );
      return slot ? { date, slot } : null;
    })
    .find((x) => x !== null);
  for (const { date, slot } of strict ? [strict] : loose ? [loose] : []) {
    const tradeoffs: string[] = [];
    const neighbors = others.filter((w) => w.date === addDays(date, -1) || w.date === addDays(date, 1));
    if (neighbors.length) tradeoffs.push(`Lands next to ${neighbors.map((w) => w.title).join(" and ")}, so less recovery in between.`);
    if (!a.profile.preferredDays.includes(weekdayOf(date))) tradeoffs.push(`${dayLong(date)} isn't one of your preferred days.`);
    if (!slot.preferred) tradeoffs.push("It's outside your preferred times of day.");
    if (!tradeoffs.length) tradeoffs.push("Same workout and volume, just a different day.");
    candidates.push({
      id: `${a.proposalId}-move`,
      kind: "move",
      title: `Move to ${formatDate(date)}`,
      summary: `Do the full ${target.title.toLowerCase()} on ${formatDate(date)} at ${formatTime(slot.start)}.`,
      tradeoffs,
      operations: [{ op: "move", workoutId: target.id, date, start: slot.start }],
    });
    break;
  }

  // 3. Different format that still supports a goal.
  const swapCategory = allowedCategories(a.profile, filter).find((c) => c !== target.category);
  if (swapCategory) {
    // Same length as the original: the user's session length is locked.
    const minutes = target.durationMin;
    const slot = findSlotWithFallback(
      { date: target.date, minutes, busy: a.busy, taken: others, notBefore: a.now },
      a.profile.preferredTimes,
    );
    const swap =
      slot &&
      buildWorkout({
        category: swapCategory,
        focus: target.muscles,
        minutes,
        filter,
        workoutTypes: a.profile.workoutTypes,
        id: target.id,
        date: target.date,
        start: slot.start,
        origin: "rule_based",
        rationale: `A lighter ${CATEGORY_STYLE[swapCategory].label.toLowerCase()} session in place of ${target.title.toLowerCase()}.`,
      });
    if (swap) {
      candidates.push({
        id: `${a.proposalId}-swap`,
        kind: "swap_format",
        title: `Switch to ${swap.title.toLowerCase()}`,
        summary: `${minutes} min of ${CATEGORY_STYLE[swapCategory].label.toLowerCase()} on ${formatDate(target.date)} at ${formatTime(swap.start)}.`,
        tradeoffs: [
          `A different kind of training. It keeps you moving, but it won't build ${CATEGORY_STYLE[target.category].label.toLowerCase()} the way the original would.`,
        ],
        operations: [{ op: "replace", workoutId: target.id, workout: swap }],
      });
    }
  }

  // Validation gate: hard rules drop an option; locked preferences make it ask first.
  const ctx = { profile: a.profile, busy: a.busy, knownRange: a.knownRange, now: a.now, previousPlan: a.plan };
  const finalize = (alt: Alternative) => finalizeAlternative(a.plan, alt, ctx);
  const valid = candidates.map(finalize).filter((x): x is Alternative => x !== null);

  if (valid.length < 3) {
    const rest: Alternative = {
      id: `${a.proposalId}-skip`,
      kind: "skip",
      title: "Skip it and rest",
      summary: `Mark ${label} as skipped. No make-up session gets added.`,
      tradeoffs: ["One fewer workout this week. Rest is a legitimate choice."],
      operations: [{ op: "skip", workoutId: target.id }],
    };
    const ok = finalize(rest);
    if (ok) valid.push(ok);
  }
  valid.sort(fitsFirst);

  return {
    ...base,
    understood: [
      "Preview mode: Pivot isn't reading your message yet.",
      `Showing options for your next workout: ${label} at ${formatTime(target.start)}.`,
    ],
    alternatives: valid.slice(0, 3),
  };
}
