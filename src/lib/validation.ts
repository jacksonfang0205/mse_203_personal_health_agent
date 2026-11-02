/**
 * Deterministic plan validation.
 *
 * This is the gate every plan must pass before it is shown or saved, whether
 * it came from the mock template, the rule-based planner, or (Phase 2) the
 * LLM agent. The eval harness uses the same functions, so "constraint
 * adherence" means exactly what this file checks.
 */
import { dayCapacity } from "./capacity";
import { getExercise } from "./catalog";
import type { DateRange } from "./calendar";
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
import { weekdayOf } from "./time";

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

export const SOFT_PREFERENCES = ["preferred_day", "experience_level"] as const;
export type SoftPreference = (typeof SOFT_PREFERENCES)[number];

export const CONSTRAINT_LABELS: Record<HardConstraint, string> = {
  schema: "Valid plan format",
  catalog_grounded: "Exercises from Pivot's catalog",
  calendar_conflict: "Fits the day's free time",
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

/** Exercises may run this much over the session length before we flag it. */
const DURATION_TOLERANCE = 1.15;

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

/** Workouts whose day or session changed relative to the previous plan (all of them without one). */
function changedIds(plan: WeeklyPlan, previous?: WeeklyPlan): Set<string> {
  const prev = new Map(previous?.workouts.map((w) => [w.id, w]));
  return new Set(
    plan.workouts
      .filter((w) => {
        const p = prev.get(w.id);
        return !previous || !p || p.date !== w.date || p.durationMin !== w.durationMin || p.status !== w.status;
      })
      .map((w) => w.id),
  );
}

/**
 * Each day's free time must have a stretch long enough for its workout.
 * For today, only time from now counts, and only for workouts this change
 * touched (an untouched workout later today isn't this change's problem).
 */
export function checkCalendarConflicts(plan: WeeklyPlan, busy: BusyBlock[], ctx?: Pick<ValidationContext, "now" | "previousPlan">): Violation[] {
  const changed = changedIds(plan, ctx?.previousPlan);
  return active(plan).flatMap((w) => {
    const fromNow = ctx?.now && ctx.now.date === w.date && changed.has(w.id) ? ctx.now.time : undefined;
    const free = dayCapacity(w.date, busy, fromNow);
    if (free >= w.durationMin) return [];
    return [
      {
        constraint: "calendar_conflict" as const,
        workoutId: w.id,
        message:
          free === 0
            ? `"${w.title}" is on ${w.date}, which has no free time.`
            : `"${w.title}" needs ${w.durationMin} min, but ${w.date} only has ${free} min free in one stretch.`,
      },
    ];
  });
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
  return active(plan).flatMap((w) =>
    w.date < ctx.knownRange.start || w.date > ctx.knownRange.end
      ? [
          {
            constraint: "grounded_availability" as const,
            workoutId: w.id,
            message: `"${w.title}" is on ${w.date}, outside the calendar range Pivot can see.`,
          },
        ]
      : [],
  );
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
  const changed = changedIds(plan, ctx.previousPlan);
  return active(plan).flatMap((w) =>
    changed.has(w.id) && w.date < now.date
      ? [
          {
            constraint: "no_past_scheduling" as const,
            workoutId: w.id,
            message: `"${w.title}" is scheduled for ${w.date}, which has already passed.`,
          },
        ]
      : [],
  );
}

const LEVEL_RANK = { beginner: 0, intermediate: 1, advanced: 2 } as const;

export function softPreferenceWarnings(plan: WeeklyPlan, profile: FitnessProfile): Violation[] {
  return active(plan).flatMap((w) => {
    const out: Violation[] = [];
    if (!profile.preferredDays.includes(weekdayOf(w.date))) {
      out.push({ constraint: "preferred_day", workoutId: w.id, message: `"${w.title}" is on a non-preferred day.` });
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
    ...checkCalendarConflicts(p, ctx.busy, ctx),
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
