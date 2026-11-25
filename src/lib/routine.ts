/**
 * Movements the user picks: finding them, swapping them into a workout, and
 * turning a routine the user already follows into the week's plan.
 * Pure functions, so they're easy to test.
 */
import { ALL_EXERCISES, getExercise } from "./catalog";
import { AVOID_TAG_LABELS, CATEGORY_STYLE, EQUIPMENT_LABELS, MUSCLE_LABELS, TIME_OF_DAY } from "./labels";
import {
  TIMES_OF_DAY,
  type ClockTime,
  type Equipment,
  type Exercise,
  type FitnessProfile,
  type IsoDate,
  type MuscleGroup,
  type Routine,
  type RoutineDay,
  type TimeOfDay,
  type WeeklyPlan,
  type Workout,
  type WorkoutCategory,
  type WorkoutExercise,
} from "./schemas";
import { toMinutes, weekDates, weekdayOf } from "./time";
import { estimateMinutes } from "./validation";

// ---------- Finding movements ----------

export interface MovementFilter {
  query: string;
  category: WorkoutCategory | "all";
  muscle: MuscleGroup | "all";
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Gym shorthand people type into a search box. */
const ALIASES: Record<string, string> = {
  db_rdl: "rdl",
  deadlift: "dl",
  overhead_press: "ohp military press",
  bench_press: "bench",
  db_bench: "bench",
  incline_db_press: "bench",
  pull_up: "pullup chin",
  chin_up: "chinup pull up pullup",
  push_up: "pushup press up",
  incline_push_up: "pushup press up",
  bulgarian_split_squat: "bss",
  kb_swing: "kettlebell",
  lat_pulldown: "lats",
  hip_thrust: "glute bridge",
  easy_run: "jog",
  tricep_pushdown: "tricep",
  overhead_tricep_ext: "tricep skull",
  bench_dip: "dips tricep",
};

/** Everything a search box should match for a movement: name, category, muscles, equipment. */
function haystack(ex: Exercise): string {
  return norm(
    [
      ex.name,
      ALIASES[ex.id] ?? "",
      CATEGORY_STYLE[ex.category].label,
      ...ex.muscles.map((m) => MUSCLE_LABELS[m]),
      ...ex.equipment.map((e) => EQUIPMENT_LABELS[e]),
      ex.equipment.length ? "" : "bodyweight no equipment",
    ].join(" "),
  );
}

/**
 * Movements matching a search and filters. Every word must match somewhere;
 * name matches come first, then movements the user has the equipment for.
 */
export function searchMovements(filter: MovementFilter, profile?: FitnessProfile | null): Exercise[] {
  const words = norm(filter.query).split(" ").filter(Boolean);
  const hits = ALL_EXERCISES.filter(
    (ex) =>
      (filter.category === "all" || ex.category === filter.category) &&
      (filter.muscle === "all" || ex.muscles.includes(filter.muscle)) &&
      words.every((w) => haystack(ex).includes(w)),
  );
  const score = (ex: Exercise) => {
    const name = norm(ex.name);
    let s = 0;
    if (words.length && name.startsWith(words.join(" "))) s -= 4;
    else if (words.length && words.every((w) => name.includes(w))) s -= 2;
    if (profile && missingEquipment(ex, profile).length) s += 1;
    return s;
  };
  return hits
    .map((ex, i) => ({ ex, i, s: score(ex) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.ex);
}

export function missingEquipment(ex: Exercise, profile: FitnessProfile): Equipment[] {
  return ex.equipment.filter((e) => !profile.equipment.includes(e));
}

/** Short reasons this movement goes against what the user said they avoid. */
export function avoidReasons(ex: Exercise, profile: FitnessProfile): string[] {
  const out = ex.tags.filter((t) => profile.avoidTags.includes(t)).map((t) => AVOID_TAG_LABELS[t].label);
  if (profile.avoidExerciseIds.includes(ex.id)) out.unshift("On your avoid list");
  return out;
}

// ---------- Prescriptions ----------

/** A movement with its usual sets and reps, ready to add to a workout. */
export function defaultEntry(ex: Exercise): WorkoutExercise {
  const p = ex.prescription;
  if (p.kind === "duration") return { exerciseId: ex.id, minutes: p.minutes };
  if (p.kind === "hold") return { exerciseId: ex.id, sets: p.sets, seconds: p.seconds };
  return { exerciseId: ex.id, sets: p.sets, reps: p.reps };
}

// ---------- Workouts built from picked movements ----------

function mostCommon<T>(items: T[]): T | undefined {
  const counts = new Map<T, number>();
  items.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Category, targets, equipment and a fair length for a list of movements. */
export function describeExercises(exercises: WorkoutExercise[]) {
  const exs = exercises.map((we) => getExercise(we.exerciseId)).filter((e): e is Exercise => !!e);
  const muscles = [...new Set(exs.flatMap((e) => e.muscles))];
  const equipment = [...new Set(exs.flatMap((e) => e.equipment))];
  const category = mostCommon(exs.map((e) => e.category)) ?? "strength";
  const minutes = Math.min(180, Math.max(5, Math.ceil(estimateMinutes({ exercises }) / 5) * 5));
  return { category, muscles, equipment, minutes };
}

/**
 * A workout with the movements the user chose. It keeps its time slot, and
 * only grows when the new movements no longer fit in it.
 */
export function withExercises(w: Workout, exercises: WorkoutExercise[]): Workout {
  const d = describeExercises(exercises);
  const fits = estimateMinutes({ exercises }) <= w.durationMin * 1.15;
  return {
    ...w,
    exercises,
    category: d.category,
    muscles: d.muscles,
    equipment: d.equipment,
    durationMin: fits ? w.durationMin : d.minutes,
    origin: "user",
  };
}

// ---------- The user's own routine ----------

/** A sensible name for a day from its movements, e.g. "Legs & glutes" or "Cardio". */
export function suggestTitle(exercises: WorkoutExercise[]): string {
  const d = describeExercises(exercises);
  if (d.category !== "strength") return CATEGORY_STYLE[d.category].label;
  // Each movement counts by its main muscle, so a Romanian deadlift reads as lower body.
  const main = exercises.map((we) => getExercise(we.exerciseId)?.muscles[0]).filter((m) => m && m !== "core");
  const upper = main.filter((m) => m && ["chest", "back", "shoulders", "arms"].includes(m)).length;
  const lower = main.filter((m) => m && ["legs", "glutes"].includes(m)).length;
  if (upper && !lower) return "Upper body";
  if (lower && !upper) return "Lower body";
  return "Full body";
}

export function routineWorkout(day: RoutineDay, date: IsoDate): Workout {
  const d = describeExercises(day.exercises);
  return {
    id: `routine-${date}-${day.day}`,
    title: day.title,
    date,
    start: day.start,
    durationMin: d.minutes,
    category: d.category,
    muscles: d.muscles,
    equipment: d.equipment,
    exercises: day.exercises,
    rationale: "From your own routine. Pivot keeps the movements you chose; change them any time.",
    status: "planned",
    origin: "user",
  };
}

/**
 * The 7-day plan for a routine. Days already finished in `keep` stay as they
 * were, so switching to a routine mid-week never loses logged work.
 */
export function planFromRoutine(args: {
  routine: Routine;
  weekStart: IsoDate;
  createdAt: string;
  keep?: Workout[];
}): WeeklyPlan {
  const keep = args.keep ?? [];
  const workouts = [...keep];
  for (const date of weekDates(args.weekStart)) {
    if (keep.some((w) => w.date === date)) continue;
    for (const day of args.routine.days.filter((d) => d.day === weekdayOf(date))) workouts.push(routineWorkout(day, date));
  }
  workouts.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return {
    id: `routine-plan-${args.weekStart}-${args.createdAt}`,
    weekStart: args.weekStart,
    workouts,
    generatedBy: "routine",
    createdAt: args.createdAt,
    notes: [],
  };
}

function timeOfDay(start: ClockTime): TimeOfDay {
  const m = toMinutes(start);
  return (
    TIMES_OF_DAY.find((t) => m >= toMinutes(TIME_OF_DAY[t].start) && m < toMinutes(TIME_OF_DAY[t].end)) ??
    (m < toMinutes("06:00") ? "early_morning" : "evening")
  );
}

/**
 * Preferences that match a routine, so the schedule checks and the coach see
 * the user's real days, times, length and equipment. Anything the user set
 * before (goals, avoidances, notes) is kept.
 */
export function profileForRoutine(routine: Routine, base: FitnessProfile | null, updatedAt: string, name?: string): FitnessProfile {
  const longest = Math.max(...routine.days.map((d) => describeExercises(d.exercises).minutes));
  const equipment = [...new Set([...(base?.equipment ?? []), ...routine.days.flatMap((d) => describeExercises(d.exercises).equipment)])];
  const nameOut = name?.trim() || base?.name;
  return {
    version: 1,
    ...(nameOut ? { name: nameOut } : {}),
    goals: base?.goals ?? ["general_fitness"],
    ...(base?.goalNotes ? { goalNotes: base.goalNotes } : {}),
    targetMuscles: base?.targetMuscles ?? [],
    experience: base?.experience ?? "intermediate",
    workoutTypes: base?.workoutTypes ?? ["gym"],
    equipment,
    ...(base?.extraEquipment ? { extraEquipment: base.extraEquipment } : {}),
    sessionMinutes: Math.min(120, Math.max(10, base ? Math.max(base.sessionMinutes, longest) : longest)),
    frequencyPerWeek: Math.min(7, routine.days.length),
    preferredDays: [...new Set(routine.days.map((d) => d.day))],
    preferredTimes: [...new Set(routine.days.map((d) => timeOfDay(d.start)))],
    avoidTags: base?.avoidTags ?? [],
    avoidExerciseIds: base?.avoidExerciseIds ?? [],
    avoidNotes: base?.avoidNotes ?? "",
    limitations: base?.limitations ?? "",
    updatedAt,
  };
}
