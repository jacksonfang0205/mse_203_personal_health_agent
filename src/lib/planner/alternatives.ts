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
import { fitMinutes } from "../capacity";
import { addDays, dayLong, weekDates, weekdayOf } from "../time";
import { validatePlan } from "../validation";
import { allowedCategories, buildWorkout, capacityOn, filterFromProfile } from "./generate";

export function applyOperations(plan: WeeklyPlan, ops: PlanOperation[]): WeeklyPlan {
  let workouts = [...plan.workouts];
  for (const op of ops) {
    switch (op.op) {
      case "move":
        workouts = workouts.map((w) => (w.id === op.workoutId ? { ...w, date: op.date } : w));
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
  workouts.sort((a, b) => a.date.localeCompare(b.date));
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
  const label = `${target.title} on ${dayLong(target.date)}`;
  const todayFree = capacityOn(target.date, a.busy, a.now);

  // 1. Shorter version, same focus.
  const shortMin = fitMinutes(target.durationMin > 25 ? 20 : Math.floor(target.durationMin / 2 / 5) * 5, todayFree);
  if (shortMin) {
    const short = buildWorkout({
        category: target.category,
        focus: target.muscles,
        minutes: shortMin,
        filter,
        workoutTypes: a.profile.workoutTypes,
        id: target.id,
        date: target.date,
        origin: "rule_based",
        title: `Quick ${target.title.toLowerCase()}`,
        rationale: `A shorter take on ${target.title.toLowerCase()} that keeps the same focus.`,
      });
    if (short) {
      candidates.push({
        id: `${a.proposalId}-shorter`,
        kind: "shorter",
        title: `${shortMin}-minute version`,
        summary: `Keep ${dayLong(target.date)}, but do a ${shortMin}-min ${CATEGORY_STYLE[target.category].label.toLowerCase()} session whenever you get a gap.`,
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
  for (const date of ranked) {
    if (capacityOn(date, a.busy, a.now) < target.durationMin) continue;
    const tradeoffs: string[] = [];
    const neighbors = others.filter((w) => w.date === addDays(date, -1) || w.date === addDays(date, 1));
    if (neighbors.length) tradeoffs.push(`Lands next to ${neighbors.map((w) => w.title).join(" and ")}, so less recovery in between.`);
    if (!a.profile.preferredDays.includes(weekdayOf(date))) tradeoffs.push(`${dayLong(date)} isn't one of your preferred days.`);
    if (!tradeoffs.length) tradeoffs.push("Same workout and volume, just a different day.");
    candidates.push({
      id: `${a.proposalId}-move`,
      kind: "move",
      title: `Move to ${dayLong(date)}`,
      summary: `Do the full ${target.title.toLowerCase()} on ${dayLong(date)} instead.`,
      tradeoffs,
      operations: [{ op: "move", workoutId: target.id, date }],
    });
    break;
  }

  // 3. Different format that still supports a goal.
  const swapCategory = allowedCategories(a.profile, filter).find((c) => c !== target.category);
  if (swapCategory) {
    const minutes = fitMinutes(Math.min(target.durationMin, 25), todayFree);
    const swap =
      minutes > 0 &&
      buildWorkout({
        category: swapCategory,
        focus: target.muscles,
        minutes,
        filter,
        workoutTypes: a.profile.workoutTypes,
        id: target.id,
        date: target.date,
        origin: "rule_based",
        rationale: `A lighter ${CATEGORY_STYLE[swapCategory].label.toLowerCase()} session in place of ${target.title.toLowerCase()}.`,
      });
    if (swap) {
      candidates.push({
        id: `${a.proposalId}-swap`,
        kind: "swap_format",
        title: `Switch to ${swap.title.toLowerCase()}`,
        summary: `${minutes} min of ${CATEGORY_STYLE[swapCategory].label.toLowerCase()} on ${dayLong(target.date)}, whenever suits you.`,
        tradeoffs: [
          `A different kind of training. It keeps you moving, but it won't build ${CATEGORY_STYLE[target.category].label.toLowerCase()} the way the original would.`,
        ],
        operations: [{ op: "replace", workoutId: target.id, workout: swap }],
      });
    }
  }

  // Validation gate: only offer options that pass every hard constraint.
  const passes = (alt: Alternative) =>
    validatePlan(applyOperations(a.plan, alt.operations), {
      profile: a.profile,
      busy: a.busy,
      knownRange: a.knownRange,
      now: a.now,
      previousPlan: a.plan,
    }).ok;
  const valid = candidates.filter(passes);

  if (valid.length < 3) {
    const rest: Alternative = {
      id: `${a.proposalId}-skip`,
      kind: "skip",
      title: "Skip it and rest",
      summary: `Mark ${label} as skipped. No make-up session gets added.`,
      tradeoffs: ["One fewer workout this week. Rest is a legitimate choice."],
      operations: [{ op: "skip", workoutId: target.id }],
    };
    if (passes(rest)) valid.push(rest);
  }

  return {
    ...base,
    understood: [
      "Preview mode: Pivot isn't reading your message yet.",
      `Showing options for your next workout: ${label}.`,
    ],
    alternatives: valid.slice(0, 3),
  };
}
