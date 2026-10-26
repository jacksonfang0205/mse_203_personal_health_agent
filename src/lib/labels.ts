/** Human-readable labels and planning constants for the domain vocabularies. */
import type {
  AvoidTag,
  Equipment,
  ExperienceLevel,
  Goal,
  MuscleGroup,
  TimeOfDay,
  Weekday,
  WorkoutCategory,
  WorkoutType,
} from "./schemas";

export const GOAL_LABELS: Record<Goal, { label: string; blurb: string }> = {
  strength: { label: "Get stronger", blurb: "Build muscle and lift with confidence" },
  endurance: { label: "Build endurance", blurb: "Go longer with less effort" },
  mobility: { label: "Move better", blurb: "Flexibility, posture, and range of motion" },
  general_fitness: { label: "Feel fit overall", blurb: "A balanced mix of everything" },
  stress_relief: { label: "De-stress", blurb: "Movement as a mental reset" },
};

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  arms: "Arms",
  core: "Core",
  glutes: "Glutes",
  legs: "Legs",
  full_body: "Full body",
};

export const EXPERIENCE_LABELS: Record<ExperienceLevel, { label: string; blurb: string }> = {
  beginner: { label: "Just starting", blurb: "New to structured workouts, or coming back after a break" },
  intermediate: { label: "Getting consistent", blurb: "Comfortable with common exercises" },
  advanced: { label: "Seasoned", blurb: "Years of training; know your way around a program" },
};

export const WORKOUT_TYPE_LABELS: Record<WorkoutType, string> = {
  gym: "Gym strength",
  home: "Home workouts",
  running: "Running",
  cycling: "Cycling",
  walking: "Walking",
  hiit: "HIIT",
  pilates: "Pilates",
  yoga: "Yoga",
  classes: "Group classes",
};

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  dumbbells: "Dumbbells",
  kettlebell: "Kettlebell",
  barbell: "Barbell",
  bench: "Bench",
  squat_rack: "Squat rack",
  cable_machine: "Cable machine",
  resistance_bands: "Resistance bands",
  pull_up_bar: "Pull-up bar",
  yoga_mat: "Yoga mat",
  treadmill: "Treadmill",
  stationary_bike: "Stationary bike",
  rower: "Rowing machine",
  jump_rope: "Jump rope",
};

/** Quick presets in onboarding; users can still toggle individual items. */
export const EQUIPMENT_PRESETS: { id: string; label: string; items: Equipment[] }[] = [
  { id: "none", label: "Just me", items: [] },
  { id: "home", label: "Home basics", items: ["dumbbells", "resistance_bands", "yoga_mat"] },
  {
    id: "gym",
    label: "Full gym",
    items: [
      "dumbbells",
      "kettlebell",
      "barbell",
      "bench",
      "squat_rack",
      "cable_machine",
      "pull_up_bar",
      "yoga_mat",
      "treadmill",
      "stationary_bike",
      "rower",
    ],
  },
];

export const AVOID_TAG_LABELS: Record<AvoidTag, { label: string; blurb: string }> = {
  high_impact: { label: "Jumping & high impact", blurb: "Jumps, burpees, running" },
  running: { label: "Running", blurb: "Any running sessions" },
  overhead: { label: "Overhead pressing", blurb: "Pressing weight above your head" },
  floor_work: { label: "Floor & kneeling work", blurb: "Lying, kneeling, or getting down to the floor" },
  heavy_barbell: { label: "Heavy barbell lifts", blurb: "Squats, deadlifts, and presses with a loaded bar" },
};

export const WEEKDAY_LABELS: Record<Weekday, { short: string; long: string }> = {
  mon: { short: "Mon", long: "Monday" },
  tue: { short: "Tue", long: "Tuesday" },
  wed: { short: "Wed", long: "Wednesday" },
  thu: { short: "Thu", long: "Thursday" },
  fri: { short: "Fri", long: "Friday" },
  sat: { short: "Sat", long: "Saturday" },
  sun: { short: "Sun", long: "Sunday" },
};

/** Wall-clock windows used both for display and for slot finding. */
export const TIME_OF_DAY: Record<TimeOfDay, { label: string; range: string; start: string; end: string }> = {
  early_morning: { label: "Early morning", range: "6–9 am", start: "06:00", end: "09:00" },
  morning: { label: "Morning", range: "9 am–12 pm", start: "09:00", end: "12:00" },
  midday: { label: "Midday", range: "12–2 pm", start: "12:00", end: "14:00" },
  afternoon: { label: "Afternoon", range: "2–5 pm", start: "14:00", end: "17:00" },
  evening: { label: "Evening", range: "5–9 pm", start: "17:00", end: "21:00" },
};

/** Visual identity per workout category. Class names refer to tokens in globals.css. */
export const CATEGORY_STYLE: Record<
  WorkoutCategory,
  { label: string; dot: string; soft: string; text: string; border: string }
> = {
  strength: { label: "Strength", dot: "bg-coral", soft: "bg-coral-soft", text: "text-coral-ink", border: "border-coral/40" },
  cardio: { label: "Cardio", dot: "bg-sky", soft: "bg-sky-soft", text: "text-sky-ink", border: "border-sky/40" },
  hiit: { label: "HIIT", dot: "bg-butter", soft: "bg-butter-soft", text: "text-butter-ink", border: "border-butter/50" },
  pilates: { label: "Pilates", dot: "bg-lilac", soft: "bg-lilac-soft", text: "text-lilac-ink", border: "border-lilac/40" },
  yoga: { label: "Yoga", dot: "bg-sage", soft: "bg-sage-soft", text: "text-sage-ink", border: "border-sage/40" },
  mobility: { label: "Mobility", dot: "bg-sage", soft: "bg-sage-soft", text: "text-sage-ink", border: "border-sage/40" },
};
