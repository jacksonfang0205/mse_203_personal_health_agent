/**
 * Deterministic, template-based planning used for Phase 1 mock data.
 *
 * This is NOT the AI agent. It exists so the UI and eval harness have
 * realistic, constraint-respecting plans to work with before the LLM is wired
 * in, and it doubles as a rule-based baseline in evals.
 */
import { EXERCISES } from "../catalog";
import { CATEGORY_STYLE, GOAL_LABELS, MUSCLE_LABELS, TIME_OF_DAY } from "../labels";
import type {
  AvoidTag,
  BusyBlock,
  ClockTime,
  Equipment,
  Exercise,
  FitnessProfile,
  Goal,
  IsoDate,
  MuscleGroup,
  TimeOfDay,
  WeeklyPlan,
  Workout,
  WorkoutCategory,
  WorkoutOrigin,
  WorkoutType,
} from "../schemas";
import { TIMES_OF_DAY } from "../schemas";
import { dayLong, fromMinutes, overlaps, toMinutes, weekDates, weekdayOf } from "../time";

const LEVEL_RANK = { beginner: 0, intermediate: 1, advanced: 2 } as const;
const SLOT_STEP = 15;
const MAX_EXERCISES = 6;
/** Breathing room kept around calendar events when picking slots. */
const BUFFER_MIN = 15;
const DAY_START = "06:00";
const DAY_END = "22:00";

const TYPE_CATEGORIES: Record<WorkoutType, WorkoutCategory[]> = {
  gym: ["strength"],
  home: ["strength", "hiit"],
  running: ["cardio"],
  cycling: ["cardio"],
  walking: ["cardio"],
  hiit: ["hiit"],
  pilates: ["pilates"],
  yoga: ["yoga"],
  classes: [],
};

const CARDIO_BY_TYPE: Partial<Record<WorkoutType, string[]>> = {
  running: ["easy_run", "run_intervals"],
  cycling: ["bike_steady", "bike_intervals"],
  walking: ["brisk_walk", "incline_walk"],
  gym: ["incline_walk", "bike_steady", "row_steady"],
};

const GOAL_CATEGORIES: Record<Goal, WorkoutCategory[]> = {
  strength: ["strength"],
  endurance: ["cardio", "hiit"],
  mobility: ["yoga", "pilates", "mobility"],
  general_fitness: ["strength", "cardio", "pilates", "hiit"],
  stress_relief: ["yoga", "cardio", "mobility"],
};

const STRENGTH_FOCI: { label: string; muscles: MuscleGroup[] }[] = [
  { label: "Lower body", muscles: ["legs", "glutes", "core"] },
  { label: "Upper body", muscles: ["chest", "back", "shoulders", "arms"] },
  { label: "Full body", muscles: ["full_body", "legs", "back", "chest", "core"] },
];

export interface ExerciseFilter {
  equipment: Equipment[];
  avoidTags: AvoidTag[];
  avoidExerciseIds: string[];
  experience: FitnessProfile["experience"];
}

export function filterFromProfile(profile: FitnessProfile, overrides: Partial<ExerciseFilter> = {}): ExerciseFilter {
  return {
    equipment: profile.equipment,
    avoidTags: profile.avoidTags,
    avoidExerciseIds: profile.avoidExerciseIds,
    experience: profile.experience,
    ...overrides,
  };
}

export function eligibleExercises(category: WorkoutCategory, f: ExerciseFilter): Exercise[] {
  const have = new Set(f.equipment);
  return EXERCISES.filter(
    (e) =>
      e.category === category &&
      e.equipment.every((x) => have.has(x)) &&
      !e.tags.some((t) => f.avoidTags.includes(t)) &&
      !f.avoidExerciseIds.includes(e.id) &&
      LEVEL_RANK[e.level] <= LEVEL_RANK[f.experience],
  );
}

export function allowedCategories(profile: FitnessProfile, f: ExerciseFilter): WorkoutCategory[] {
  const fromTypes = new Set(profile.workoutTypes.flatMap((t) => TYPE_CATEGORIES[t]));
  fromTypes.add("mobility"); // bodyweight mobility is always an option
  return [...fromTypes].filter((c) => eligibleExercises(c, f).length > 0);
}

/** Category order for the week: goal-driven, limited to what the user enjoys and can do. */
export function categoryRotation(profile: FitnessProfile, f: ExerciseFilter): WorkoutCategory[] {
  const allowed = allowedCategories(profile, f);
  const lists = profile.goals.map((g) => GOAL_CATEGORIES[g].filter((c) => allowed.includes(c)));
  const rotation: WorkoutCategory[] = [];
  for (let i = 0; i < 4; i++) {
    for (const list of lists) {
      const c = list[i];
      if (c && !rotation.includes(c)) rotation.push(c);
    }
  }
  // Then anything else the user said they enjoy, so preferences show up in the week.
  for (const c of allowed) if (c !== "mobility" && !rotation.includes(c)) rotation.push(c);
  return rotation.length ? rotation : ["mobility"];
}

export interface BuildArgs {
  category: WorkoutCategory;
  focus: MuscleGroup[];
  minutes: number;
  filter: ExerciseFilter;
  workoutTypes: WorkoutType[];
  id: string;
  date: IsoDate;
  start: ClockTime;
  origin: WorkoutOrigin;
  rationale: string;
  title?: string;
}

/** Assemble a catalog-grounded workout that fits the time budget, or null if impossible. */
export function buildWorkout(a: BuildArgs): Workout | null {
  const pool = eligibleExercises(a.category, a.filter);
  if (!pool.length) return null;

  let picked: { ex: Exercise; minutes?: number }[] = [];
  if (a.category === "cardio") {
    // Gym cardio machines are a fallback; named activities (running, cycling, walking) come first.
    const types = [...a.workoutTypes.filter((t) => t !== "gym"), ...a.workoutTypes.filter((t) => t === "gym")];
    const preferred = types.flatMap((t) => CARDIO_BY_TYPE[t] ?? []);
    const main = preferred.map((id) => pool.find((e) => e.id === id)).find(Boolean) ?? pool[0];
    picked = [{ ex: main, minutes: a.minutes }];
  } else {
    // Prefer exercises that hit the focus, then ones closest to the user's level,
    // then loaded variations. One exercise per primary muscle keeps sessions varied.
    const score = (e: Exercise) => e.muscles.filter((m) => a.focus.includes(m)).length;
    const ranked = [...pool].sort(
      (x, y) =>
        score(y) - score(x) ||
        LEVEL_RANK[y.level] - LEVEL_RANK[x.level] ||
        y.equipment.length - x.equipment.length,
    );
    // Strength sessions stick to the focus muscles with one exercise per primary
    // muscle; flow-style sessions (yoga, Pilates, mobility, HIIT) just fill the time.
    const strict = a.category === "strength";
    const onFocus = ranked.filter((e) => score(e) > 0);
    const primaries = new Set<MuscleGroup>();
    let used = 0;
    const add = (ex: Exercise) => {
      picked.push({ ex });
      primaries.add(ex.muscles[0]);
      used += ex.minutes;
    };
    for (const ex of strict && onFocus.length ? onFocus : ranked) {
      if (picked.length >= MAX_EXERCISES) break;
      if ((strict && primaries.has(ex.muscles[0])) || used + ex.minutes > a.minutes) continue;
      add(ex);
    }
    // Second pass if the session is still mostly empty.
    for (const ex of ranked) {
      if (used >= a.minutes * 0.6 || picked.length >= MAX_EXERCISES) break;
      if (!picked.some((p) => p.ex.id === ex.id) && used + ex.minutes <= a.minutes) add(ex);
    }
    if (!picked.length) return null;
  }

  const muscles = [...new Set(picked.flatMap((p) => p.ex.muscles))];
  const equipment = [...new Set(picked.flatMap((p) => p.ex.equipment))];
  return {
    id: a.id,
    title: a.title ?? defaultTitle(a.category, a.focus, picked[0].ex),
    date: a.date,
    start: a.start,
    durationMin: a.minutes,
    category: a.category,
    muscles,
    equipment,
    exercises: picked.map(({ ex, minutes }) => {
      const p = ex.prescription;
      if (p.kind === "duration") return { exerciseId: ex.id, minutes: minutes ?? p.minutes };
      if (p.kind === "hold") return { exerciseId: ex.id, sets: p.sets, seconds: p.seconds };
      return { exerciseId: ex.id, sets: p.sets, reps: p.reps };
    }),
    rationale: a.rationale,
    status: "planned",
    origin: a.origin,
  };
}

function defaultTitle(category: WorkoutCategory, focus: MuscleGroup[], first: Exercise): string {
  switch (category) {
    case "strength": {
      const preset = STRENGTH_FOCI.find((f) => f.muscles === focus);
      if (preset) return `${preset.label} strength`;
      const named = focus.filter((m) => m !== "full_body").slice(0, 2);
      if (!named.length) return "Full body strength";
      const words = named.map((m, i) => (i ? MUSCLE_LABELS[m].toLowerCase() : MUSCLE_LABELS[m]));
      return `${words.join(" & ")} strength`;
    }
    case "cardio":
      return first.name;
    case "hiit":
      return first.tags.includes("high_impact") ? "HIIT circuit" : "Low-impact HIIT";
    case "pilates":
      return first.equipment.includes("yoga_mat") ? "Mat Pilates" : "Standing Pilates";
    case "yoga":
      return "Yoga flow";
    case "mobility":
      return "Mobility reset";
  }
}

// ---------- Slot finding ----------

export interface SlotQuery {
  date: IsoDate;
  minutes: number;
  busy: BusyBlock[];
  /** Other workouts already placed; treated as busy. */
  taken: Pick<Workout, "date" | "start" | "durationMin">[];
  /** Preferred windows to search, in order. Omit to search the whole day. */
  windows?: TimeOfDay[];
  /** Earliest allowed start (e.g. now). */
  notBefore?: { date: IsoDate; time: ClockTime };
}

export function findSlot(q: SlotQuery): ClockTime | null {
  const ranges = (q.windows ?? [null]).map((w) =>
    w ? [toMinutes(TIME_OF_DAY[w].start), toMinutes(TIME_OF_DAY[w].end)] : [toMinutes(DAY_START), toMinutes(DAY_END)],
  );
  const dayEnd = toMinutes(DAY_END);
  let earliest = 0;
  if (q.notBefore) {
    if (q.date < q.notBefore.date) return null;
    if (q.date === q.notBefore.date) {
      earliest = Math.ceil((toMinutes(q.notBefore.time) + 30) / SLOT_STEP) * SLOT_STEP;
    }
  }
  const blocks = [
    ...q.busy
      .filter((b) => b.date === q.date)
      .map((b) => [toMinutes(b.start) - BUFFER_MIN, toMinutes(b.end) + BUFFER_MIN]),
    ...q.taken.filter((t) => t.date === q.date).map((t) => [toMinutes(t.start), toMinutes(t.start) + t.durationMin]),
  ];
  for (const [from, to] of ranges) {
    for (let s = Math.max(from, earliest); s < to; s += SLOT_STEP) {
      const e = s + q.minutes;
      if (e > dayEnd) break;
      if (!blocks.some(([bs, be]) => overlaps(s, e, bs, be))) return fromMinutes(s);
    }
  }
  return null;
}

/** Try preferred windows first, then anywhere in the day. */
export function findSlotWithFallback(q: Omit<SlotQuery, "windows">, preferred: TimeOfDay[]) {
  const ordered = TIMES_OF_DAY.filter((t) => preferred.includes(t));
  const inPreferred = findSlot({ ...q, windows: ordered });
  if (inPreferred) return { start: inPreferred, preferred: true };
  const any = findSlot(q);
  return any ? { start: any, preferred: false } : null;
}

function windowLabelFor(start: ClockTime): string {
  const m = toMinutes(start);
  const hit = TIMES_OF_DAY.find((t) => m >= toMinutes(TIME_OF_DAY[t].start) && m < toMinutes(TIME_OF_DAY[t].end));
  return hit ? TIME_OF_DAY[hit].label.toLowerCase() : "open";
}

// ---------- Mock week ----------

export interface MockWeekArgs {
  profile: FitnessProfile;
  weekStart: IsoDate;
  busy: BusyBlock[];
  now?: { date: IsoDate; time: ClockTime };
  /** Workouts to carry over unchanged (e.g. completed ones when preferences change). */
  keep?: Workout[];
  createdAt: string;
}

/** Spread `n` picks across `items` as evenly as possible. */
function spread<T>(items: T[], n: number): T[] {
  if (n >= items.length) return [...items];
  return Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]);
}

export function generateMockWeek(args: MockWeekArgs): WeeklyPlan {
  const { profile, weekStart, busy, now } = args;
  const keep = args.keep ?? [];
  const filter = filterFromProfile(profile);
  const rotation = categoryRotation(profile, filter);
  const notes: string[] = [];

  const usable = weekDates(weekStart).filter(
    (d) => (!now || d >= now.date) && !keep.some((k) => k.date === d),
  );
  const preferredDates = usable.filter((d) => profile.preferredDays.includes(weekdayOf(d)));
  const otherDates = usable.filter((d) => !profile.preferredDays.includes(weekdayOf(d)));
  const target = Math.max(0, profile.frequencyPerWeek - keep.length);

  const chosen = spread(preferredDates, target);
  const fallbacks = [...preferredDates.filter((d) => !chosen.includes(d)), ...otherDates];

  const workouts: Workout[] = [...keep];
  let strengthIdx = 0;
  let sessionIdx = 0;

  const tryPlace = (date: IsoDate): boolean => {
    const category = rotation[sessionIdx % rotation.length];
    const focus =
      category === "strength"
        ? profile.targetMuscles.length && !profile.targetMuscles.includes("full_body")
          ? profile.targetMuscles
          : STRENGTH_FOCI[strengthIdx % STRENGTH_FOCI.length].muscles
        : profile.targetMuscles;
    const slot = findSlotWithFallback(
      { date, minutes: profile.sessionMinutes, busy, taken: workouts, notBefore: now },
      profile.preferredTimes,
    );
    if (!slot) return false;
    const goal = profile.goals.find((g) => GOAL_CATEGORIES[g].includes(category)) ?? profile.goals[0];
    const rationale =
      `${CATEGORY_STYLE[category].label} work toward your goal to ${GOAL_LABELS[goal].label.toLowerCase()}. ` +
      `Placed in your free ${windowLabelFor(slot.start)} on ${dayLong(date)}` +
      (slot.preferred ? ", clear of your calendar." : " — outside your preferred times, but it's the open slot that day.");
    const w = buildWorkout({
      category,
      focus,
      minutes: profile.sessionMinutes,
      filter,
      workoutTypes: profile.workoutTypes,
      id: `wk-${weekStart}-${sessionIdx}`,
      date,
      start: slot.start,
      origin: "mock_template",
      rationale,
    });
    if (!w) return false;
    workouts.push(w);
    sessionIdx++;
    if (category === "strength") strengthIdx++;
    return true;
  };

  let placed = 0;
  for (const date of chosen) if (tryPlace(date)) placed++;
  for (const date of fallbacks) {
    if (placed >= target) break;
    if (!workouts.some((w) => w.date === date) && tryPlace(date)) placed++;
  }

  if (placed < target) {
    notes.push(
      usable.length < target
        ? `Only ${usable.length} day${usable.length === 1 ? "" : "s"} left this week, so this plan has ${placed + keep.length} of your ${profile.frequencyPerWeek} workouts.`
        : `Found time for ${placed + keep.length} of your ${profile.frequencyPerWeek} workouts this week. Your calendar is full on the other days.`,
    );
  }
  if (profile.workoutTypes.includes("classes")) {
    notes.push("Group classes aren't scheduled yet. Studio and class discovery is planned for a later version.");
  }
  if (profile.preferredDays.length < profile.frequencyPerWeek) {
    notes.push("You asked for more workouts than preferred days, so some land on other days.");
  }

  workouts.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return {
    id: `plan-${weekStart}`,
    weekStart,
    workouts,
    generatedBy: "mock_template",
    createdAt: args.createdAt,
    notes,
  };
}
