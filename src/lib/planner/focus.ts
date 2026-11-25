/**
 * Proportionate, region-level edits to a workout: add a short mobility block,
 * swap a region's strength moves for mobility, or turn the session toward a
 * region. Each edit keeps the workout's day, start time and length and only
 * touches the exercises it has to.
 */
import { EXERCISES, getExercise } from "../catalog";
import type { BodyFocus, Exercise, FitnessProfile, MuscleGroup, Workout, WorkoutExercise } from "../schemas";
import { buildWorkout, eligibleExercises, filterFromProfile, type ExerciseFilter } from "./generate";

export type Region = "lower" | "upper";

export const REGION_MUSCLES: Record<Region, MuscleGroup[]> = {
  lower: ["legs", "glutes"],
  upper: ["chest", "back", "shoulders", "arms"],
};
export const REGION_LABEL: Record<Region, string> = { lower: "lower-body", upper: "upper-body" };

/** The region an exercise mainly trains (most of its listed muscles), if any. A deadlift (back, glutes, legs) is lower-body. */
export function regionOf(ex: Pick<Exercise, "muscles">): Region | null {
  const lower = ex.muscles.filter((m) => REGION_MUSCLES.lower.includes(m)).length;
  const upper = ex.muscles.filter((m) => REGION_MUSCLES.upper.includes(m)).length;
  if (!lower && !upper) return null;
  return lower >= upper ? "lower" : "upper";
}

/** True when the workout has at least one strength move whose main muscle is in the region. */
export function trainsRegion(w: Workout, region: Region): boolean {
  return w.exercises.some((we) => {
    const ex = getExercise(we.exerciseId);
    return !!ex && ex.category === "strength" && regionOf(ex) === region;
  });
}

/** Mobility moves for a region the user can do (equipment, avoid tags, level all respected). */
export function mobilityMoves(region: Region, filter: ExerciseFilter): Exercise[] {
  const muscles = REGION_MUSCLES[region];
  return [...eligibleExercises("mobility", filter), ...eligibleExercises("yoga", filter)].filter(
    (e) => e.muscles.some((m) => muscles.includes(m)) && e.minutes <= 6,
  );
}

const prescribe = (ex: Exercise): WorkoutExercise => {
  const p = ex.prescription;
  if (p.kind === "duration") return { exerciseId: ex.id, minutes: p.minutes };
  if (p.kind === "hold") return { exerciseId: ex.id, sets: p.sets, seconds: p.seconds };
  return { exerciseId: ex.id, sets: p.sets, reps: p.reps };
};

const minutesOf = (we: WorkoutExercise) => {
  const ex = getExercise(we.exerciseId);
  if (!ex) return 0;
  return ex.prescription.kind === "duration" ? (we.minutes ?? ex.prescription.minutes) : ex.minutes;
};

function finish(w: Workout, exercises: WorkoutExercise[], title: string): Workout {
  const list = exercises.map((we) => getExercise(we.exerciseId)!).filter(Boolean);
  const allMobility = list.every((e) => e.category === "mobility" || e.category === "yoga");
  return {
    ...w,
    title,
    exercises,
    category: allMobility ? "mobility" : w.category,
    muscles: [...new Set(list.flatMap((e) => e.muscles))],
    equipment: [...new Set(list.flatMap((e) => e.equipment))],
  };
}

export type TrimFrom = Region | "last";

/**
 * Make room for about `minutes` of region mobility inside the same session:
 * trim moves (from `trimFrom` first, else from the end), then append mobility
 * moves. Returns null if nothing can be added.
 */
export function addMobilityBlock(w: Workout, region: Region, profile: FitnessProfile, minutes = 10, trimFrom: TrimFrom = region): Workout | null {
  const moves = mobilityMoves(region, filterFromProfile(profile)).filter((e) => !w.exercises.some((we) => we.exerciseId === e.id));
  const block: Exercise[] = [];
  let blockMin = 0;
  for (const e of moves) {
    if (blockMin >= minutes) break;
    block.push(e);
    blockMin += e.minutes;
  }
  if (!block.length) return null;
  const used = w.exercises.reduce((s, we) => s + minutesOf(we), 0);
  let free = w.durationMin - used;
  const keep = [...w.exercises];
  // Trim the preferred region's moves first (from the end), then anything from the end.
  const order = keep
    .map((we, i) => ({ we, i, r: regionOf(getExercise(we.exerciseId) ?? { muscles: ["full_body"] }) }))
    .sort((a, b) => Number(b.r === trimFrom) - Number(a.r === trimFrom) || b.i - a.i);
  const drop = new Set<number>();
  for (const { we, i } of order) {
    if (free >= blockMin || keep.length - drop.size <= 1) break;
    drop.add(i);
    free += minutesOf(we);
  }
  const exercises = [...keep.filter((_, i) => !drop.has(i)), ...block.map(prescribe)];
  return finish(w, exercises, `${w.title} + ${REGION_LABEL[region]} mobility`);
}

/** Swap the region's strength moves for mobility moves; everything else stays. Null if the day has none. */
export function swapRegionForMobility(w: Workout, region: Region, profile: FitnessProfile): Workout | null {
  if (!trainsRegion(w, region)) return null;
  const pool = mobilityMoves(region, filterFromProfile(profile)).filter((e) => !w.exercises.some((we) => we.exerciseId === e.id));
  const exercises: WorkoutExercise[] = [];
  for (const we of w.exercises) {
    const ex = getExercise(we.exerciseId);
    if (ex && ex.category === "strength" && regionOf(ex) === region) {
      const sub = pool.shift();
      if (sub) exercises.push(prescribe(sub));
      continue;
    }
    exercises.push(we);
  }
  if (!exercises.length) return null;
  const title = exercises.every((we) => ["mobility", "yoga"].includes(getExercise(we.exerciseId)?.category ?? ""))
    ? `${REGION_LABEL[region].charAt(0).toUpperCase()}${REGION_LABEL[region].slice(1)} mobility`
    : `${w.title} (${REGION_LABEL[region]} mobility)`;
  return finish(w, exercises, title);
}

/** Rebuild the session in the same slot for a region: strength or mobility. */
export function rebuildForRegion(w: Workout, region: Region, style: "strength" | "mobility", profile: FitnessProfile): Workout | null {
  const label = `${REGION_LABEL[region].charAt(0).toUpperCase()}${REGION_LABEL[region].slice(1)} ${style}`;
  // Leave out the other region's strength moves so the session really trains this one.
  const other: Region = region === "lower" ? "upper" : "lower";
  const base = filterFromProfile(profile);
  const exclude = EXERCISES.filter((e) => e.category === "strength" && regionOf(e) === other).map((e) => e.id);
  return buildWorkout({
    category: style,
    focus: region === "lower" ? ["legs", "glutes", "core"] : REGION_MUSCLES.upper,
    minutes: w.durationMin,
    filter: { ...base, avoidExerciseIds: [...base.avoidExerciseIds, ...exclude] },
    workoutTypes: profile.workoutTypes,
    id: w.id,
    date: w.date,
    start: w.start,
    origin: w.origin,
    title: label,
    rationale: `${label}, as you asked your coach.`,
  });
}

/** Plain-language body focus, for memory, the AI context and Preferences. */
export function describeBodyFocus(f: BodyFocus | undefined): string[] {
  if (!f) return [];
  const say = (r: Region, e: BodyFocus["lower"]) =>
    e === "mobility"
      ? `${REGION_LABEL[r].charAt(0).toUpperCase()}${REGION_LABEL[r].slice(1)}: mobility & function, not strength/growth`
      : e === "strength"
        ? `${REGION_LABEL[r].charAt(0).toUpperCase()}${REGION_LABEL[r].slice(1)}: more strength focus`
        : `${REGION_LABEL[r].charAt(0).toUpperCase()}${REGION_LABEL[r].slice(1)}: less focus`;
  return (["lower", "upper"] as Region[]).filter((r) => f[r]).map((r) => say(r, f[r]));
}

/**
 * Apply the stored body focus to a freshly planned workout (template planner):
 * a lower-body strength day for someone who wants lower-body mobility swaps
 * those moves for mobility; same for upper.
 */
export function applyBodyFocus(w: Workout, profile: FitnessProfile): Workout {
  const f = profile.bodyFocus;
  if (!f || w.category !== "strength") return w;
  let out = w;
  for (const r of ["lower", "upper"] as Region[]) {
    if (f[r] === "mobility") out = swapRegionForMobility(out, r, profile) ?? out;
  }
  return out;
}
