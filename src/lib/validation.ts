/**
 * Deterministic plan validation.
 *
 * This is the gate every plan must pass before it is shown or saved, whether
 * it came from the mock template, the rule-based planner, or (Phase 2) the
 * LLM agent. The eval harness uses the same functions, so "constraint
 * adherence" means exactly what this file checks.
 */
import { getExercise } from "./catalog";
import type { DateRange } from "./calendar";
import { TIME_OF_DAY } from "./labels";
import {
  WeeklyPlan,
  type AvoidTag,
  type BusyBlock,
  type ClockTime,
  type Equipment,
  type FitnessProfile,
  type IsoDate,
  type Workout,
} from "./schemas";
import { compareMoments, overlaps, toMinutes, weekdayOf } from "./time";

export const HARD_CONSTRAINTS = [
  "schema",
  "catalog_grounded",
  "calendar_conflict",
  "duration_limit",
  "equipment",
  "avoided_activity",
  "completed_preserved",
  "grounded_availability",
  "no_volume_spike",
  "no_past_scheduling",
] as const;
export type HardConstraint = (typeof HARD_CONSTRAINTS)[number];

export const SOFT_PREFERENCES = ["preferred_day", "preferred_time", "experience_level"] as const;
export type SoftPreference = (typeof SOFT_PREFERENCES)[number];

export const CONSTRAINT_LABELS: Record<HardConstraint, string> = {
  schema: "Valid plan format",
  catalog_grounded: "Exercises from Pivot's catalog",
  calendar_conflict: "No calendar conflicts",
  duration_limit: "Within your time limits",
  equipment: "Uses only available equipment",
  avoided_activity: "Respects what you avoid",
  completed_preserved: "Completed workouts untouched",
  grounded_availability: "Only uses known free time",
  no_volume_spike: "No make-up overload",
  no_past_scheduling: "Nothing scheduled in the past",
};

export interface Violation {
  constraint: HardConstraint | SoftPreference;
  workoutId?: string;
  message: string;
}

export interface ValidationContext {
  profile: FitnessProfile;
  busy: BusyBlock[];
  /** Dates the calendar provider can vouch for. Anything outside is unknown, not free. */
  knownRange: DateRange;
  /** Earliest start / latest end for any workout. Defaults to 06:00–22:00. */
  dayWindow?: { start: ClockTime; end: ClockTime };
  now?: { date: IsoDate; time: ClockTime };
  /** The plan before this change. Enables completed/volume/past checks. */
  previousPlan?: WeeklyPlan;
  /** Max workout minutes per date (e.g. "only 20 minutes Friday"). 0 = no time that day. */
  dateLimits?: Partial<Record<IsoDate, number>>;
  /** Overrides profile equipment, e.g. when traveling. */
  equipmentAvailable?: Equipment[];
  extraAvoidTags?: AvoidTag[];
}

export interface ValidationResult {
  ok: boolean;
  violations: Violation[];
  warnings: Violation[];
  checked: HardConstraint[];
}

const DEFAULT_DAY_WINDOW = { start: "06:00", end: "22:00" };
/** Exercises may run this much over the session length before we flag it. */
const DURATION_TOLERANCE = 1.15;

const endMinutes = (w: Pick<Workout, "start" | "durationMin">) => toMinutes(w.start) + w.durationMin;
const active = (plan: WeeklyPlan) => plan.workouts.filter((w) => w.status === "planned");

/** Estimated minutes for a workout's exercises, scaled when sets/minutes are overridden. */
export function estimateMinutes(workout: Pick<Workout, "exercises">): number {
  return workout.exercises.reduce((sum, we) => {
    const ex = getExercise(we.exerciseId);
    if (!ex) return sum;
    const p = ex.prescription;
    if (p.kind === "duration") return sum + (we.minutes ?? p.minutes);
    const scale = we.sets ? we.sets / p.sets : 1;
    return sum + ex.minutes * scale;
  }, 0);
}

export function checkCatalog(plan: WeeklyPlan): Violation[] {
  return plan.workouts.flatMap((w) =>
    w.exercises
      .filter((we) => !getExercise(we.exerciseId))
      .map((we) => ({
        constraint: "catalog_grounded" as const,
        workoutId: w.id,
        message: `"${w.title}" uses unknown exercise "${we.exerciseId}".`,
      })),
  );
}

export function checkCalendarConflicts(plan: WeeklyPlan, busy: BusyBlock[]): Violation[] {
  const out: Violation[] = [];
  const workouts = active(plan);
  for (const w of workouts) {
    for (const b of busy) {
      if (b.date === w.date && overlaps(toMinutes(w.start), endMinutes(w), toMinutes(b.start), toMinutes(b.end))) {
        out.push({
          constraint: "calendar_conflict",
          workoutId: w.id,
          message: `"${w.title}" (${w.date} ${w.start}) overlaps "${b.title}" (${b.start}–${b.end}).`,
        });
      }
    }
  }
  // Workouts may not overlap each other either.
  workouts.forEach((a, i) =>
    workouts.slice(i + 1).forEach((b) => {
      if (a.date === b.date && overlaps(toMinutes(a.start), endMinutes(a), toMinutes(b.start), endMinutes(b))) {
        out.push({
          constraint: "calendar_conflict",
          workoutId: b.id,
          message: `"${a.title}" and "${b.title}" overlap on ${a.date}.`,
        });
      }
    }),
  );
  return out;
}

export function checkDurations(plan: WeeklyPlan, ctx: ValidationContext): Violation[] {
  const out: Violation[] = [];
  const perDate = new Map<IsoDate, number>();
  for (const w of active(plan)) {
    perDate.set(w.date, (perDate.get(w.date) ?? 0) + w.durationMin);
    if (w.durationMin > ctx.profile.sessionMinutes) {
      out.push({
        constraint: "duration_limit",
        workoutId: w.id,
        message: `"${w.title}" is ${w.durationMin} min; your limit is ${ctx.profile.sessionMinutes} min.`,
      });
    }
    const est = estimateMinutes(w);
    if (est > w.durationMin * DURATION_TOLERANCE) {
      out.push({
        constraint: "duration_limit",
        workoutId: w.id,
        message: `"${w.title}" lists about ${Math.round(est)} min of exercises in a ${w.durationMin}-min slot.`,
      });
    }
  }
  for (const [date, minutes] of perDate) {
    const limit = ctx.dateLimits?.[date];
    if (limit !== undefined && minutes > limit) {
      out.push({
        constraint: "duration_limit",
        message:
          limit === 0
            ? `A workout is scheduled on ${date}, when no time is available.`
            : `${minutes} min scheduled on ${date}; only ${limit} min available.`,
      });
    }
  }
  return out;
}

export function checkEquipment(plan: WeeklyPlan, available: Equipment[]): Violation[] {
  const have = new Set(available);
  return active(plan).flatMap((w) => {
    const needed = new Set<Equipment>(w.equipment);
    w.exercises.forEach((we) => getExercise(we.exerciseId)?.equipment.forEach((e) => needed.add(e)));
    const missing = [...needed].filter((e) => !have.has(e));
    return missing.length
      ? [{ constraint: "equipment" as const, workoutId: w.id, message: `"${w.title}" needs ${missing.join(", ")}.` }]
      : [];
  });
}

export function checkAvoidance(plan: WeeklyPlan, profile: FitnessProfile, extraTags: AvoidTag[] = []): Violation[] {
  const tags = new Set([...profile.avoidTags, ...extraTags]);
  const ids = new Set(profile.avoidExerciseIds);
  return active(plan).flatMap((w) =>
    w.exercises.flatMap((we) => {
      const ex = getExercise(we.exerciseId);
      if (!ex) return [];
      const hitTags = ex.tags.filter((t) => tags.has(t));
      if (ids.has(ex.id) || hitTags.length) {
        return [
          {
            constraint: "avoided_activity" as const,
            workoutId: w.id,
            message: `"${w.title}" includes ${ex.name}${hitTags.length ? ` (${hitTags.join(", ")})` : ""}, which you asked to avoid.`,
          },
        ];
      }
      return [];
    }),
  );
}

function sameWorkout(a: Workout, b: Workout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function checkCompletedPreserved(plan: WeeklyPlan, previous: WeeklyPlan): Violation[] {
  return previous.workouts
    .filter((w) => w.status === "completed")
    .flatMap((prev) => {
      const next = plan.workouts.find((w) => w.id === prev.id);
      if (next && sameWorkout(prev, next)) return [];
      return [
        {
          constraint: "completed_preserved" as const,
          workoutId: prev.id,
          message: next
            ? `Completed workout "${prev.title}" was modified.`
            : `Completed workout "${prev.title}" was removed.`,
        },
      ];
    });
}

export function checkGroundedAvailability(plan: WeeklyPlan, ctx: ValidationContext): Violation[] {
  const window = ctx.dayWindow ?? DEFAULT_DAY_WINDOW;
  return active(plan).flatMap((w) => {
    if (w.date < ctx.knownRange.start || w.date > ctx.knownRange.end) {
      return [
        {
          constraint: "grounded_availability" as const,
          workoutId: w.id,
          message: `"${w.title}" is on ${w.date}, outside the calendar range Pivot can see.`,
        },
      ];
    }
    if (toMinutes(w.start) < toMinutes(window.start) || endMinutes(w) > toMinutes(window.end)) {
      return [
        {
          constraint: "grounded_availability" as const,
          workoutId: w.id,
          message: `"${w.title}" falls outside ${window.start}–${window.end}.`,
        },
      ];
    }
    return [];
  });
}

export function checkVolume(plan: WeeklyPlan, ctx: ValidationContext): Violation[] {
  const out: Violation[] = [];
  const counted = (p: WeeklyPlan) => p.workouts.filter((w) => w.status !== "skipped");
  const prev = ctx.previousPlan ? counted(ctx.previousPlan) : [];
  const next = counted(plan);

  const maxCount = Math.max(ctx.profile.frequencyPerWeek, prev.length);
  if (next.length > maxCount) {
    out.push({ constraint: "no_volume_spike", message: `${next.length} workouts scheduled; the cap is ${maxCount}.` });
  }

  const minutes = (ws: Workout[]) => ws.reduce((s, w) => s + w.durationMin, 0);
  const maxMinutes = Math.max(ctx.profile.frequencyPerWeek * ctx.profile.sessionMinutes, minutes(prev));
  if (minutes(next) > maxMinutes) {
    out.push({
      constraint: "no_volume_spike",
      message: `${minutes(next)} weekly minutes scheduled; the cap is ${maxMinutes}.`,
    });
  }

  const perDay = (ws: Workout[]) =>
    ws.reduce((m, w) => m.set(w.date, (m.get(w.date) ?? 0) + 1), new Map<IsoDate, number>());
  const prevPerDay = perDay(prev);
  for (const [date, n] of perDay(next)) {
    if (n > Math.max(1, prevPerDay.get(date) ?? 0)) {
      out.push({ constraint: "no_volume_spike", message: `${n} workouts stacked on ${date}.` });
    }
  }

  for (const w of active(plan)) {
    for (const we of w.exercises) {
      const ex = getExercise(we.exerciseId);
      if (ex && ex.prescription.kind !== "duration" && we.sets && we.sets > ex.prescription.sets + 1) {
        out.push({
          constraint: "no_volume_spike",
          workoutId: w.id,
          message: `${ex.name} has ${we.sets} sets in "${w.title}" (typical: ${ex.prescription.sets}).`,
        });
      }
    }
  }
  return out;
}

export function checkNoPastScheduling(plan: WeeklyPlan, ctx: ValidationContext): Violation[] {
  if (!ctx.now) return [];
  const now = ctx.now;
  const prevById = new Map(ctx.previousPlan?.workouts.map((w) => [w.id, w]));
  return active(plan).flatMap((w) => {
    const prev = prevById.get(w.id);
    const changed = !prev || prev.date !== w.date || prev.start !== w.start || prev.status !== w.status;
    if (changed && compareMoments({ date: w.date, time: w.start }, now) < 0) {
      return [
        {
          constraint: "no_past_scheduling" as const,
          workoutId: w.id,
          message: `"${w.title}" is scheduled for ${w.date} ${w.start}, which has already passed.`,
        },
      ];
    }
    return [];
  });
}

const LEVEL_RANK = { beginner: 0, intermediate: 1, advanced: 2 } as const;

export function softPreferenceWarnings(plan: WeeklyPlan, profile: FitnessProfile): Violation[] {
  return active(plan).flatMap((w) => {
    const out: Violation[] = [];
    if (!profile.preferredDays.includes(weekdayOf(w.date))) {
      out.push({ constraint: "preferred_day", workoutId: w.id, message: `"${w.title}" is on a non-preferred day.` });
    }
    const inPreferredTime = profile.preferredTimes.some((t) => {
      const win = TIME_OF_DAY[t];
      return toMinutes(w.start) >= toMinutes(win.start) && toMinutes(w.start) < toMinutes(win.end);
    });
    if (!inPreferredTime) {
      out.push({ constraint: "preferred_time", workoutId: w.id, message: `"${w.title}" starts outside your preferred times.` });
    }
    for (const we of w.exercises) {
      const ex = getExercise(we.exerciseId);
      if (ex && LEVEL_RANK[ex.level] > LEVEL_RANK[profile.experience]) {
        out.push({
          constraint: "experience_level",
          workoutId: w.id,
          message: `${ex.name} is usually suggested for ${ex.level} lifters.`,
        });
      }
    }
    return out;
  });
}

export function validatePlan(plan: unknown, ctx: ValidationContext): ValidationResult {
  const parsed = WeeklyPlan.safeParse(plan);
  if (!parsed.success) {
    return {
      ok: false,
      violations: parsed.error.issues.map((i) => ({
        constraint: "schema",
        message: `${i.path.join(".") || "plan"}: ${i.message}`,
      })),
      warnings: [],
      checked: ["schema"],
    };
  }
  const p = parsed.data;
  const checked: HardConstraint[] = [
    "schema",
    "catalog_grounded",
    "calendar_conflict",
    "duration_limit",
    "equipment",
    "avoided_activity",
    "grounded_availability",
    "no_volume_spike",
  ];
  const violations = [
    ...checkCatalog(p),
    ...checkCalendarConflicts(p, ctx.busy),
    ...checkDurations(p, ctx),
    ...checkEquipment(p, ctx.equipmentAvailable ?? ctx.profile.equipment),
    ...checkAvoidance(p, ctx.profile, ctx.extraAvoidTags),
    ...checkGroundedAvailability(p, ctx),
    ...checkVolume(p, ctx),
  ];
  if (ctx.previousPlan) {
    checked.push("completed_preserved");
    violations.push(...checkCompletedPreserved(p, ctx.previousPlan));
  }
  if (ctx.now) {
    checked.push("no_past_scheduling");
    violations.push(...checkNoPastScheduling(p, ctx));
  }
  return { ok: violations.length === 0, violations, warnings: softPreferenceWarnings(p, ctx.profile), checked };
}
