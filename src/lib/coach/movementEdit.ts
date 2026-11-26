/**
 * "Add barbell bench press", "drop the lunges on Friday", "swap goblet squat for leg press".
 * A request about one movement changes that movement only: the day keeps its
 * title, time, focus and the rest of its movements. This is handled in code,
 * before the AI, because the AI tends to answer it by rebuilding the whole day
 * (a lower-body day turned into an upper-body day to fit a bench press).
 */
import { ALL_EXERCISES } from "../catalog";
import { defaultEntry, missingEquipment, withExercises } from "../routine";
import type { Exercise, FitnessProfile, IsoDate, PlanOperation, WeeklyPlan, Workout, WorkoutExercise } from "../schemas";
import { addDays, formatDate } from "../time";

export type MovementEditKind = "add" | "remove" | "swap";

export interface MovementEdit {
  kind: MovementEditKind;
  /** add: the movement to add; swap: the one coming in. */
  add?: Exercise;
  /** remove: the movement to drop; swap: the one going out. */
  remove?: Exercise;
  /** "add a set of …" / "add 2 sets of …" when the movement is already in the workout. */
  sets?: number;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[-–/]/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Shorthand people type for a movement, on top of its name. */
const SAY: Record<string, string[]> = {
  bench_press: ["bench press", "barbell bench", "bench"],
  db_bench: ["dumbbell bench", "db bench"],
  db_rdl: ["rdl", "rdls", "romanian deadlift", "romanian deadlifts"],
  deadlift: ["deadlift", "deadlifts"],
  overhead_press: ["ohp", "overhead press", "military press"],
  bulgarian_split_squat: ["bss", "bulgarian split squat", "bulgarian split squats", "split squats"],
  pull_up: ["pull up", "pull ups", "pullup", "pullups"],
  chin_up: ["chin up", "chin ups", "chinup", "chinups"],
  push_up: ["push up", "push ups", "pushup", "pushups"],
  hip_thrust: ["hip thrust", "hip thrusts"],
  goblet_squat: ["goblet squat", "goblet squats"],
};

/** Every way a movement can be named in a message, longest first so "dumbbell bench press" beats "bench press". */
function phrasesFor(ex: Exercise): string[] {
  const name = norm(ex.name);
  const base = [name, name.endsWith("s") ? name : `${name}s`, ...(SAY[ex.id] ?? [])];
  return [...new Set(base.map(norm))];
}

const PHRASES = ALL_EXERCISES.flatMap((ex) => phrasesFor(ex).map((p) => ({ ex, p }))).sort((a, b) => b.p.length - a.p.length);

/** Movements named in the text, in order of appearance, without overlaps. */
export function movementsIn(text: string): Exercise[] {
  const t = ` ${norm(text)} `;
  const taken: [number, number][] = [];
  const found: { at: number; ex: Exercise }[] = [];
  for (const { ex, p } of PHRASES) {
    let from = 0;
    for (;;) {
      const at = t.indexOf(` ${p} `, from);
      if (at < 0) break;
      from = at + 1;
      const end = at + p.length + 1;
      if (taken.some(([a, b]) => at < b && end > a)) continue;
      taken.push([at, end]);
      if (!found.some((f) => f.ex.id === ex.id)) found.push({ at, ex });
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.ex);
}

const ADD = /\b(add|include|throw in|put in|squeeze in|i want to do|let me do)\b/i;
const REMOVE = /\b(remove|drop|take out|cut|delete|get rid of|no more|skip the)\b/i;
const SWAP = /\b(swap|replace|switch|change|instead of)\b/i;
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, another: 1, extra: 1, two: 2, three: 3, four: 4 };

/** A request to add, remove or swap one movement, or null when the message is about something else. */
export function parseMovementEdit(message: string): MovementEdit | null {
  const found = movementsIn(message);
  if (!found.length) return null;
  const t = message.toLowerCase();
  if (SWAP.test(t) && found.length >= 2) {
    // "swap A for B" / "replace A with B": A goes out. "B instead of A": A goes out.
    const insteadOf = /instead of/.test(t);
    const [first, second] = found;
    return insteadOf ? { kind: "swap", add: first, remove: second } : { kind: "swap", remove: first, add: second };
  }
  if (REMOVE.test(t) && !ADD.test(t)) return { kind: "remove", remove: found[0] };
  if (ADD.test(t)) {
    const m = t.match(/\b(a|an|one|another|extra|two|three|four|\d)\s+(?:more\s+|extra\s+)?sets?\b/);
    const sets = m ? (NUM[m[1]] ?? Number(m[1])) : undefined;
    return { kind: "add", add: found[0], sets };
  }
  return null;
}

const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** The workout a movement request is about: a day named in the message, otherwise today's, otherwise the next one. */
export function targetWorkout(message: string, plan: WeeklyPlan, today: IsoDate): Workout | null {
  const upcoming = plan.workouts
    .filter((w) => w.status === "planned" && w.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  const t = message.toLowerCase();
  if (/\btomorrow\b/.test(t)) return upcoming.find((w) => w.date === addDays(today, 1)) ?? null;
  if (/\b(today|tonight|this morning|this evening)\b/.test(t)) return upcoming.find((w) => w.date === today) ?? null;
  const day = t.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
  if (day) {
    const want = WEEKDAYS[day[1]];
    return upcoming.find((w) => new Date(`${w.date}T12:00:00Z`).getUTCDay() === want) ?? null;
  }
  return upcoming.find((w) => w.date === today) ?? upcoming[0] ?? null;
}

export interface MovementChange {
  operation: PlanOperation;
  workout: Workout;
  title: string;
  /** Honest notes: missing equipment, a longer session, a movement that wasn't there. */
  notes: string[];
}

/** Build the one-workout change for a movement request, or explain why it can't be done. */
export function buildMovementChange(
  edit: MovementEdit,
  target: Workout,
  profile: FitnessProfile,
): { change: MovementChange } | { problem: string } {
  const day = formatDate(target.date);
  const has = (ex?: Exercise) => (ex ? target.exercises.findIndex((we) => we.exerciseId === ex.id) : -1);
  const notes: string[] = [];
  let exercises: WorkoutExercise[] = target.exercises;
  let title: string;

  if (edit.kind === "add" && edit.add) {
    const i = has(edit.add);
    if (i >= 0) {
      const we = target.exercises[i];
      const more = edit.sets ?? 1;
      exercises = target.exercises.map((x, k) => (k === i ? { ...x, sets: Math.min(10, (x.sets ?? 1) + more) } : x));
      title = `${more} more set${more > 1 ? "s" : ""} of ${edit.add.name}`;
      notes.push(`${edit.add.name} goes from ${we.sets ?? 1} to ${exercises[i].sets} sets.`);
    } else {
      const entry = defaultEntry(edit.add);
      exercises = [...target.exercises, edit.sets && entry.sets ? { ...entry, sets: edit.sets } : entry];
      title = `Add ${edit.add.name}`;
    }
    const missing = missingEquipment(edit.add, profile);
    if (missing.length) notes.push(`Needs ${missing.join(" and ")}, which isn't in your equipment list.`);
  } else if (edit.kind === "remove" && edit.remove) {
    const i = has(edit.remove);
    if (i < 0) return { problem: `${edit.remove.name} isn't in your ${target.title.toLowerCase()} workout on ${day}.` };
    if (target.exercises.length <= 1) return { problem: `${edit.remove.name} is the only movement on ${day}. To drop the whole workout, ask me to skip it.` };
    exercises = target.exercises.filter((_, k) => k !== i);
    title = `Drop ${edit.remove.name}`;
  } else if (edit.kind === "swap" && edit.add && edit.remove) {
    const i = has(edit.remove);
    if (i < 0) return { problem: `${edit.remove.name} isn't in your ${target.title.toLowerCase()} workout on ${day}.` };
    const entry = defaultEntry(edit.add);
    exercises = target.exercises.map((x, k) => (k === i ? entry : x));
    title = `Swap in ${edit.add.name}`;
    const missing = missingEquipment(edit.add, profile);
    if (missing.length) notes.push(`Needs ${missing.join(" and ")}, which isn't in your equipment list.`);
  } else {
    return { problem: "I couldn't tell which movement to change." };
  }

  // Keep the day as it is: same title, time and slot; only the movement list changes.
  const edited = { ...withExercises(target, exercises), title: target.title };
  if (edited.durationMin > target.durationMin) notes.push(`The session runs about ${edited.durationMin} min instead of ${target.durationMin}.`);
  return { change: { operation: { op: "replace", workoutId: target.id, workout: edited }, workout: edited, title, notes } };
}

/** For the AI prompt and tests: a short description of a movement request. */
export function describeEdit(edit: MovementEdit): string {
  if (edit.kind === "add") return `add ${edit.add?.name}`;
  if (edit.kind === "remove") return `remove ${edit.remove?.name}`;
  return `swap ${edit.remove?.name} for ${edit.add?.name}`;
}
