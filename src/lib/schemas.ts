/**
 * Pivot domain schemas.
 *
 * Every piece of data that crosses a boundary (localStorage, eval fixtures,
 * and in Phase 2 the LLM's structured output) is parsed with these schemas.
 * Keep this file free of UI and storage concerns.
 */
import { z } from "zod";

// ---------- Primitive vocabularies ----------

export const GOALS = [
  "strength",
  "endurance",
  "mobility",
  "general_fitness",
  "stress_relief",
] as const;
export const Goal = z.enum(GOALS);
export type Goal = z.infer<typeof Goal>;

export const MUSCLE_GROUPS = [
  "chest",
  "back",
  "shoulders",
  "arms",
  "core",
  "glutes",
  "legs",
  "full_body",
] as const;
export const MuscleGroup = z.enum(MUSCLE_GROUPS);
export type MuscleGroup = z.infer<typeof MuscleGroup>;

export const EXPERIENCE_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export const ExperienceLevel = z.enum(EXPERIENCE_LEVELS);
export type ExperienceLevel = z.infer<typeof ExperienceLevel>;

/** What the user says they like doing (onboarding vocabulary). */
export const WORKOUT_TYPES = [
  "gym",
  "home",
  "running",
  "cycling",
  "walking",
  "hiit",
  "pilates",
  "yoga",
  "classes",
] as const;
export const WorkoutType = z.enum(WORKOUT_TYPES);
export type WorkoutType = z.infer<typeof WorkoutType>;

/** What a scheduled session actually is (planning vocabulary). */
export const WORKOUT_CATEGORIES = [
  "strength",
  "cardio",
  "hiit",
  "pilates",
  "yoga",
  "mobility",
] as const;
export const WorkoutCategory = z.enum(WORKOUT_CATEGORIES);
export type WorkoutCategory = z.infer<typeof WorkoutCategory>;

export const EQUIPMENT = [
  "dumbbells",
  "kettlebell",
  "barbell",
  "bench",
  "squat_rack",
  "cable_machine",
  "resistance_bands",
  "pull_up_bar",
  "yoga_mat",
  "treadmill",
  "stationary_bike",
  "rower",
  "jump_rope",
] as const;
export const Equipment = z.enum(EQUIPMENT);
export type Equipment = z.infer<typeof Equipment>;

/** Machine-checkable things a user can ask Pivot to avoid. */
export const AVOID_TAGS = [
  "high_impact",
  "running",
  "overhead",
  "floor_work",
  "heavy_barbell",
] as const;
export const AvoidTag = z.enum(AVOID_TAGS);
export type AvoidTag = z.infer<typeof AvoidTag>;

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const Weekday = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof Weekday>;

export const TIMES_OF_DAY = [
  "early_morning",
  "morning",
  "midday",
  "afternoon",
  "evening",
] as const;
export const TimeOfDay = z.enum(TIMES_OF_DAY);
export type TimeOfDay = z.infer<typeof TimeOfDay>;

/** Local calendar date, e.g. "2026-11-02". Times are wall-clock, no time zone. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export type IsoDate = z.infer<typeof IsoDate>;

/** 24h wall-clock time, e.g. "07:30". */
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");
export type ClockTime = z.infer<typeof ClockTime>;

// ---------- Fitness profile ----------

export const FitnessProfile = z.object({
  version: z.literal(1),
  name: z.string().trim().max(60).optional(),
  goals: z.array(Goal).min(1),
  targetMuscles: z.array(MuscleGroup),
  experience: ExperienceLevel,
  workoutTypes: z.array(WorkoutType).min(1),
  /** Equipment the user can reliably access. Bodyweight is always available. */
  equipment: z.array(Equipment),
  /** Preferred session length; treated as the hard per-session maximum. */
  sessionMinutes: z.number().int().min(10).max(120),
  frequencyPerWeek: z.number().int().min(1).max(7),
  preferredDays: z.array(Weekday).min(1),
  preferredTimes: z.array(TimeOfDay).min(1),
  avoidTags: z.array(AvoidTag),
  avoidExerciseIds: z.array(z.string()),
  /** Free text. Not machine-checked; passed to the agent as context only. */
  avoidNotes: z.string().max(500),
  /** Optional, user-stated. Pivot never diagnoses or prescribes rehab. */
  limitations: z.string().max(500),
  updatedAt: z.string(),
});
export type FitnessProfile = z.infer<typeof FitnessProfile>;

// ---------- Exercise catalog ----------

export const Prescription = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reps"), sets: z.number().int(), reps: z.string() }),
  z.object({ kind: z.literal("hold"), sets: z.number().int(), seconds: z.number().int() }),
  z.object({ kind: z.literal("duration"), minutes: z.number().int() }),
]);
export type Prescription = z.infer<typeof Prescription>;

export const Exercise = z.object({
  id: z.string(),
  name: z.string(),
  category: WorkoutCategory,
  muscles: z.array(MuscleGroup).min(1),
  /** All of these are required to perform the exercise. Empty = bodyweight. */
  equipment: z.array(Equipment),
  /** Minimum experience level we'd suggest this for. */
  level: ExperienceLevel,
  tags: z.array(AvoidTag),
  prescription: Prescription,
  /** Approximate minutes including rest, used for duration budgeting. */
  minutes: z.number().positive(),
  cue: z.string(),
});
export type Exercise = z.infer<typeof Exercise>;

// ---------- Plans ----------

export const WorkoutExercise = z.object({
  exerciseId: z.string(),
  sets: z.number().int().min(1).max(8).optional(),
  reps: z.string().optional(),
  seconds: z.number().int().positive().optional(),
  minutes: z.number().int().positive().optional(),
});
export type WorkoutExercise = z.infer<typeof WorkoutExercise>;

export const WORKOUT_STATUSES = ["planned", "completed", "skipped"] as const;
export const WorkoutStatus = z.enum(WORKOUT_STATUSES);
export type WorkoutStatus = z.infer<typeof WorkoutStatus>;

/** Who produced a workout. Shown in the UI so mock data is never mistaken for AI output. */
export const WorkoutOrigin = z.enum(["mock_template", "rule_based", "agent", "user"]);
export type WorkoutOrigin = z.infer<typeof WorkoutOrigin>;

export const Workout = z.object({
  id: z.string(),
  title: z.string(),
  date: IsoDate,
  start: ClockTime,
  durationMin: z.number().int().min(5).max(180),
  category: WorkoutCategory,
  muscles: z.array(MuscleGroup),
  equipment: z.array(Equipment),
  exercises: z.array(WorkoutExercise).min(1),
  rationale: z.string(),
  status: WorkoutStatus,
  origin: WorkoutOrigin,
});
export type Workout = z.infer<typeof Workout>;

export const WeeklyPlan = z.object({
  id: z.string(),
  /** Monday of the plan's week. */
  weekStart: IsoDate,
  workouts: z.array(Workout),
  generatedBy: z.enum(["mock_template", "agent", "fixture"]),
  createdAt: z.string(),
  /** Goals or constraints the plan could not satisfy, in plain language. */
  notes: z.array(z.string()),
});
export type WeeklyPlan = z.infer<typeof WeeklyPlan>;

// ---------- Calendar ----------

export const BusyBlock = z.object({
  id: z.string(),
  date: IsoDate,
  start: ClockTime,
  end: ClockTime,
  title: z.string(),
  source: z.enum(["simulated", "google", "user_message", "blocked"]),
});
export type BusyBlock = z.infer<typeof BusyBlock>;

// ---------- Life Happens proposals ----------

export const PlanOperation = z.discriminatedUnion("op", [
  z.object({ op: z.literal("move"), workoutId: z.string(), date: IsoDate, start: ClockTime }),
  z.object({ op: z.literal("replace"), workoutId: z.string(), workout: Workout }),
  z.object({ op: z.literal("skip"), workoutId: z.string() }),
  z.object({ op: z.literal("add"), workout: Workout }),
]);
export type PlanOperation = z.infer<typeof PlanOperation>;

export const ALTERNATIVE_KINDS = ["shorter", "move", "swap_format", "skip"] as const;
export const AlternativeKind = z.enum(ALTERNATIVE_KINDS);
export type AlternativeKind = z.infer<typeof AlternativeKind>;

export const Alternative = z.object({
  id: z.string(),
  kind: AlternativeKind,
  title: z.string(),
  summary: z.string(),
  /** Honest costs of choosing this option. Never claim equivalence. */
  tradeoffs: z.array(z.string()),
  operations: z.array(PlanOperation).min(1),
});
export type Alternative = z.infer<typeof Alternative>;

export const Proposal = z.object({
  id: z.string(),
  createdAt: z.string(),
  userMessage: z.string(),
  /** What the planner understood changed. */
  understood: z.array(z.string()),
  alternatives: z.array(Alternative).max(3),
  /** Set when no feasible alternative exists; the planner must say so rather than invent time. */
  infeasibleReason: z.string().optional(),
  generatedBy: z.enum(["rule_based_mock", "agent"]),
});
export type Proposal = z.infer<typeof Proposal>;

export const ChangeRecord = z.object({
  id: z.string(),
  at: z.string(),
  userMessage: z.string(),
  proposalId: z.string(),
  decision: z.enum(["accepted", "rejected"]),
  alternativeId: z.string().optional(),
  alternativeKind: AlternativeKind.optional(),
  summary: z.string(),
  offeredKinds: z.array(AlternativeKind),
});
export type ChangeRecord = z.infer<typeof ChangeRecord>;

// ---------- Memory ----------

/**
 * A time the user can't work out. Pivot treats it as busy, exactly like a
 * calendar event. Recurring on `days`, or a one-off when `date` is set.
 */
export const BlockedTime = z.object({
  id: z.string(),
  days: z.array(Weekday),
  date: IsoDate.optional(),
  start: ClockTime,
  end: ClockTime,
  label: z.string().trim().max(80),
  source: z.enum(["user", "agent"]),
  createdAt: z.string(),
});
export type BlockedTime = z.infer<typeof BlockedTime>;

/** A durable preference in the user's own words, passed to the agent as context. */
export const MemoryNote = z.object({
  id: z.string(),
  text: z.string().trim().min(1).max(300),
  source: z.enum(["user", "agent"]),
  createdAt: z.string(),
});
export type MemoryNote = z.infer<typeof MemoryNote>;

/** What actually happened to a workout. Survives across weeks so Pivot can learn from it. */
export const WorkoutLogEntry = z.object({
  workoutId: z.string(),
  date: IsoDate,
  start: ClockTime,
  durationMin: z.number().int(),
  category: WorkoutCategory,
  status: z.enum(["completed", "skipped"]),
  at: z.string(),
});
export type WorkoutLogEntry = z.infer<typeof WorkoutLogEntry>;
