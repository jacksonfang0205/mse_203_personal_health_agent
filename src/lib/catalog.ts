/**
 * Curated exercise catalog. Pivot only recommends exercises from this list,
 * which lets deterministic validators check equipment and avoidance rules.
 *
 * Prescriptions are general-population starting points, not medical or
 * rehabilitation advice. `minutes` approximates working time plus rest.
 */
import type { Exercise } from "./schemas";

const reps = (sets: number, r: string) => ({ kind: "reps" as const, sets, reps: r });
const hold = (sets: number, seconds: number) => ({ kind: "hold" as const, sets, seconds });
const duration = (minutes: number) => ({ kind: "duration" as const, minutes });

export const EXERCISES: Exercise[] = [
  // ----- Strength: bodyweight -----
  { id: "bw_squat", name: "Bodyweight squat", category: "strength", muscles: ["legs", "glutes"], equipment: [], level: "beginner", tags: [], prescription: reps(3, "12–15"), minutes: 5, cue: "Sit back between your heels, chest tall." },
  { id: "reverse_lunge", name: "Reverse lunge", category: "strength", muscles: ["legs", "glutes"], equipment: [], level: "beginner", tags: [], prescription: reps(3, "8–10 / side"), minutes: 6, cue: "Step back softly; front knee tracks over toes." },
  { id: "glute_bridge", name: "Glute bridge", category: "strength", muscles: ["glutes", "core"], equipment: [], level: "beginner", tags: ["floor_work"], prescription: reps(3, "12–15"), minutes: 5, cue: "Drive through heels, pause at the top." },
  { id: "incline_push_up", name: "Incline push-up", category: "strength", muscles: ["chest", "arms", "shoulders"], equipment: [], level: "beginner", tags: [], prescription: reps(3, "8–12"), minutes: 5, cue: "Hands on a counter or wall; body in one line." },
  { id: "push_up", name: "Push-up", category: "strength", muscles: ["chest", "arms", "core"], equipment: [], level: "intermediate", tags: ["floor_work"], prescription: reps(3, "8–12"), minutes: 5, cue: "Elbows about 45°, brace your core." },
  { id: "plank", name: "Forearm plank", category: "strength", muscles: ["core"], equipment: [], level: "beginner", tags: ["floor_work"], prescription: hold(3, 30), minutes: 4, cue: "Squeeze glutes, keep hips level." },
  { id: "dead_bug", name: "Dead bug", category: "strength", muscles: ["core"], equipment: [], level: "beginner", tags: ["floor_work"], prescription: reps(3, "8 / side"), minutes: 4, cue: "Low back stays heavy on the floor." },
  { id: "wall_sit", name: "Wall sit", category: "strength", muscles: ["legs"], equipment: [], level: "beginner", tags: [], prescription: hold(3, 30), minutes: 4, cue: "Knees over ankles, back flat on the wall." },
  { id: "step_up", name: "Step-up", category: "strength", muscles: ["legs", "glutes"], equipment: ["bench"], level: "beginner", tags: [], prescription: reps(3, "8 / side"), minutes: 6, cue: "Press through the whole front foot." },

  // ----- Strength: dumbbells & kettlebell -----
  { id: "goblet_squat", name: "Goblet squat", category: "strength", muscles: ["legs", "glutes", "core"], equipment: ["dumbbells"], level: "beginner", tags: [], prescription: reps(3, "8–12"), minutes: 7, cue: "Hold the weight at your chest; elbows inside knees." },
  { id: "db_rdl", name: "Dumbbell Romanian deadlift", category: "strength", muscles: ["glutes", "legs", "back"], equipment: ["dumbbells"], level: "beginner", tags: [], prescription: reps(3, "8–10"), minutes: 7, cue: "Hinge at the hips, weights close to your legs." },
  { id: "db_row", name: "One-arm dumbbell row", category: "strength", muscles: ["back", "arms"], equipment: ["dumbbells"], level: "beginner", tags: [], prescription: reps(3, "10 / side"), minutes: 7, cue: "Pull your elbow toward your hip." },
  { id: "db_bench", name: "Dumbbell bench press", category: "strength", muscles: ["chest", "arms", "shoulders"], equipment: ["dumbbells", "bench"], level: "beginner", tags: [], prescription: reps(3, "8–12"), minutes: 7, cue: "Feet planted, lower with control." },
  { id: "db_floor_press", name: "Dumbbell floor press", category: "strength", muscles: ["chest", "arms"], equipment: ["dumbbells"], level: "beginner", tags: ["floor_work"], prescription: reps(3, "10–12"), minutes: 6, cue: "Pause when elbows touch the floor." },
  { id: "db_shoulder_press", name: "Dumbbell shoulder press", category: "strength", muscles: ["shoulders", "arms"], equipment: ["dumbbells"], level: "beginner", tags: ["overhead"], prescription: reps(3, "8–10"), minutes: 6, cue: "Ribs down, press straight up." },
  { id: "db_lateral_raise", name: "Lateral raise", category: "strength", muscles: ["shoulders"], equipment: ["dumbbells"], level: "beginner", tags: [], prescription: reps(3, "12–15"), minutes: 5, cue: "Lead with elbows, stop at shoulder height." },
  { id: "db_curl", name: "Dumbbell curl", category: "strength", muscles: ["arms"], equipment: ["dumbbells"], level: "beginner", tags: [], prescription: reps(3, "10–12"), minutes: 5, cue: "Elbows pinned, no swinging." },
  { id: "db_split_squat", name: "Split squat", category: "strength", muscles: ["legs", "glutes"], equipment: ["dumbbells"], level: "intermediate", tags: [], prescription: reps(3, "8 / side"), minutes: 7, cue: "Drop the back knee straight down." },
  { id: "kb_swing", name: "Kettlebell swing", category: "strength", muscles: ["glutes", "legs", "back"], equipment: ["kettlebell"], level: "intermediate", tags: [], prescription: reps(4, "12"), minutes: 6, cue: "Snap the hips; arms just guide the bell." },

  // ----- Strength: gym -----
  { id: "back_squat", name: "Barbell back squat", category: "strength", muscles: ["legs", "glutes", "core"], equipment: ["barbell", "squat_rack"], level: "intermediate", tags: ["heavy_barbell"], prescription: reps(4, "5–8"), minutes: 12, cue: "Brace before you descend; even pressure through feet." },
  { id: "deadlift", name: "Barbell deadlift", category: "strength", muscles: ["back", "glutes", "legs"], equipment: ["barbell"], level: "intermediate", tags: ["heavy_barbell"], prescription: reps(3, "5"), minutes: 12, cue: "Bar over midfoot, push the floor away." },
  { id: "bench_press", name: "Barbell bench press", category: "strength", muscles: ["chest", "arms", "shoulders"], equipment: ["barbell", "bench"], level: "intermediate", tags: ["heavy_barbell"], prescription: reps(4, "6–8"), minutes: 10, cue: "Shoulder blades pinned, bar to lower chest." },
  { id: "overhead_press", name: "Barbell overhead press", category: "strength", muscles: ["shoulders", "arms", "core"], equipment: ["barbell", "squat_rack"], level: "advanced", tags: ["heavy_barbell", "overhead"], prescription: reps(4, "5–6"), minutes: 10, cue: "Squeeze glutes, head through at the top." },
  { id: "lat_pulldown", name: "Lat pulldown", category: "strength", muscles: ["back", "arms"], equipment: ["cable_machine"], level: "beginner", tags: [], prescription: reps(3, "10–12"), minutes: 6, cue: "Pull to your upper chest, don't lean back far." },
  { id: "cable_row", name: "Seated cable row", category: "strength", muscles: ["back", "arms"], equipment: ["cable_machine"], level: "beginner", tags: [], prescription: reps(3, "10–12"), minutes: 6, cue: "Tall spine, squeeze shoulder blades." },
  { id: "face_pull", name: "Cable face pull", category: "strength", muscles: ["shoulders", "back"], equipment: ["cable_machine"], level: "beginner", tags: [], prescription: reps(3, "12–15"), minutes: 5, cue: "Pull toward your eyes, thumbs back." },
  { id: "pull_up", name: "Pull-up", category: "strength", muscles: ["back", "arms"], equipment: ["pull_up_bar"], level: "advanced", tags: [], prescription: reps(4, "4–8"), minutes: 8, cue: "Start from a dead hang, chest to bar." },

  // ----- Strength: bands -----
  { id: "band_row", name: "Band row", category: "strength", muscles: ["back", "arms"], equipment: ["resistance_bands"], level: "beginner", tags: [], prescription: reps(3, "12–15"), minutes: 5, cue: "Anchor low, pull elbows back." },
  { id: "band_pull_apart", name: "Band pull-apart", category: "strength", muscles: ["shoulders", "back"], equipment: ["resistance_bands"], level: "beginner", tags: [], prescription: reps(3, "15"), minutes: 4, cue: "Arms straight, pull to chest height." },
  { id: "band_squat", name: "Banded squat", category: "strength", muscles: ["legs", "glutes"], equipment: ["resistance_bands"], level: "beginner", tags: [], prescription: reps(3, "12–15"), minutes: 5, cue: "Stand on the band, handles at shoulders." },
  { id: "band_chest_press", name: "Band chest press", category: "strength", muscles: ["chest", "arms"], equipment: ["resistance_bands"], level: "beginner", tags: [], prescription: reps(3, "12"), minutes: 5, cue: "Anchor behind you, press forward slowly." },

  // ----- Cardio -----
  { id: "easy_run", name: "Easy run", category: "cardio", muscles: ["legs", "full_body"], equipment: [], level: "beginner", tags: ["running", "high_impact"], prescription: duration(25), minutes: 25, cue: "Conversational pace; walk breaks are fine." },
  { id: "run_intervals", name: "Run intervals", category: "cardio", muscles: ["legs", "full_body"], equipment: [], level: "intermediate", tags: ["running", "high_impact"], prescription: duration(20), minutes: 20, cue: "6 × 1 min strong, 2 min easy." },
  { id: "brisk_walk", name: "Brisk walk", category: "cardio", muscles: ["legs", "full_body"], equipment: [], level: "beginner", tags: [], prescription: duration(25), minutes: 25, cue: "Fast enough that talking takes effort." },
  { id: "incline_walk", name: "Treadmill incline walk", category: "cardio", muscles: ["legs", "glutes"], equipment: ["treadmill"], level: "beginner", tags: [], prescription: duration(20), minutes: 20, cue: "Moderate incline, no holding the rails." },
  { id: "bike_steady", name: "Steady bike", category: "cardio", muscles: ["legs", "full_body"], equipment: ["stationary_bike"], level: "beginner", tags: [], prescription: duration(25), minutes: 25, cue: "Even cadence, moderate effort." },
  { id: "bike_intervals", name: "Bike intervals", category: "cardio", muscles: ["legs", "full_body"], equipment: ["stationary_bike"], level: "intermediate", tags: [], prescription: duration(20), minutes: 20, cue: "8 × 30 s hard, 90 s easy." },
  { id: "row_steady", name: "Steady row", category: "cardio", muscles: ["back", "legs", "full_body"], equipment: ["rower"], level: "beginner", tags: [], prescription: duration(20), minutes: 20, cue: "Legs, then body, then arms." },

  // ----- HIIT -----
  { id: "jump_rope", name: "Jump rope rounds", category: "hiit", muscles: ["legs", "full_body"], equipment: ["jump_rope"], level: "intermediate", tags: ["high_impact"], prescription: hold(6, 45), minutes: 8, cue: "Small hops, wrists do the work." },
  { id: "squat_jump", name: "Squat jump", category: "hiit", muscles: ["legs", "glutes"], equipment: [], level: "intermediate", tags: ["high_impact"], prescription: reps(4, "10"), minutes: 5, cue: "Land softly and sink into the next rep." },
  { id: "burpee", name: "Burpee", category: "hiit", muscles: ["full_body"], equipment: [], level: "intermediate", tags: ["high_impact", "floor_work"], prescription: reps(4, "8"), minutes: 6, cue: "Step back instead of jumping if needed." },
  { id: "mountain_climber", name: "Mountain climber", category: "hiit", muscles: ["core", "shoulders", "full_body"], equipment: [], level: "beginner", tags: ["floor_work"], prescription: hold(4, 30), minutes: 5, cue: "Hips low, knees drive fast." },
  { id: "low_impact_circuit", name: "Low-impact cardio circuit", category: "hiit", muscles: ["full_body"], equipment: [], level: "beginner", tags: [], prescription: hold(5, 40), minutes: 8, cue: "Step jacks, skater steps, standing knee drives." },

  // ----- Pilates (mat) -----
  { id: "pilates_hundred", name: "The Hundred", category: "pilates", muscles: ["core"], equipment: ["yoga_mat"], level: "beginner", tags: ["floor_work"], prescription: hold(1, 100), minutes: 3, cue: "Pump arms, breathe in 5, out 5." },
  { id: "pilates_roll_up", name: "Roll-up", category: "pilates", muscles: ["core"], equipment: ["yoga_mat"], level: "intermediate", tags: ["floor_work"], prescription: reps(2, "6"), minutes: 4, cue: "Peel the spine up one segment at a time." },
  { id: "pilates_single_leg_stretch", name: "Single-leg stretch", category: "pilates", muscles: ["core"], equipment: ["yoga_mat"], level: "beginner", tags: ["floor_work"], prescription: reps(2, "10 / side"), minutes: 4, cue: "Shoulders lifted, low back anchored." },
  { id: "pilates_side_leg", name: "Side-lying leg series", category: "pilates", muscles: ["glutes", "legs"], equipment: ["yoga_mat"], level: "beginner", tags: ["floor_work"], prescription: reps(2, "12 / side"), minutes: 6, cue: "Stack hips, move only the top leg." },
  { id: "pilates_swimming", name: "Swimming", category: "pilates", muscles: ["back", "glutes"], equipment: ["yoga_mat"], level: "beginner", tags: ["floor_work"], prescription: hold(3, 30), minutes: 4, cue: "Long limbs, small fast flutters." },
  { id: "pilates_bridge", name: "Pilates bridge roll", category: "pilates", muscles: ["glutes", "core"], equipment: ["yoga_mat"], level: "beginner", tags: ["floor_work"], prescription: reps(2, "10"), minutes: 4, cue: "Articulate the spine up and down." },
  { id: "standing_pilates", name: "Standing Pilates series", category: "pilates", muscles: ["core", "glutes", "legs"], equipment: [], level: "beginner", tags: [], prescription: duration(12), minutes: 12, cue: "Leg circles, pliés, and balance work, all standing." },

  // ----- Yoga -----
  { id: "sun_salutation", name: "Sun salutation flow", category: "yoga", muscles: ["full_body"], equipment: ["yoga_mat"], level: "beginner", tags: ["floor_work"], prescription: duration(8), minutes: 8, cue: "One breath per movement." },
  { id: "warrior_flow", name: "Warrior flow", category: "yoga", muscles: ["legs", "glutes", "shoulders"], equipment: [], level: "beginner", tags: [], prescription: duration(10), minutes: 10, cue: "Warrior I, II, and reverse warrior, each side." },
  { id: "balance_series", name: "Standing balance series", category: "yoga", muscles: ["legs", "core"], equipment: [], level: "beginner", tags: [], prescription: duration(6), minutes: 6, cue: "Tree pose and warrior III; use a wall if needed." },
  { id: "low_lunge", name: "Low lunge", category: "yoga", muscles: ["legs", "glutes"], equipment: ["yoga_mat"], level: "beginner", tags: ["floor_work"], prescription: hold(2, 45), minutes: 4, cue: "Sink hips forward, lift through the chest." },
  { id: "pigeon_pose", name: "Pigeon pose", category: "yoga", muscles: ["glutes"], equipment: ["yoga_mat"], level: "intermediate", tags: ["floor_work"], prescription: hold(2, 60), minutes: 5, cue: "Square hips; prop with a block or pillow." },
  { id: "yoga_wind_down", name: "Seated wind-down", category: "yoga", muscles: ["back", "legs"], equipment: ["yoga_mat"], level: "beginner", tags: ["floor_work"], prescription: duration(6), minutes: 6, cue: "Forward fold, twist, and slow breathing." },

  // ----- Mobility -----
  { id: "worlds_greatest_stretch", name: "World's greatest stretch", category: "mobility", muscles: ["legs", "glutes", "back"], equipment: [], level: "beginner", tags: [], prescription: reps(2, "5 / side"), minutes: 5, cue: "Lunge, elbow to instep, rotate open." },
  { id: "cat_cow", name: "Cat-cow", category: "mobility", muscles: ["back", "core"], equipment: [], level: "beginner", tags: ["floor_work"], prescription: reps(2, "10"), minutes: 3, cue: "Move with your breath." },
  { id: "hip_90_90", name: "90/90 hip switches", category: "mobility", muscles: ["glutes", "legs"], equipment: [], level: "beginner", tags: ["floor_work"], prescription: reps(2, "8 / side"), minutes: 4, cue: "Sit tall; use hands for support." },
  { id: "open_books", name: "Thoracic open books", category: "mobility", muscles: ["back", "shoulders"], equipment: [], level: "beginner", tags: ["floor_work"], prescription: reps(2, "8 / side"), minutes: 4, cue: "Knees stacked, follow your hand with your eyes." },
  { id: "hip_circles", name: "Standing hip circles", category: "mobility", muscles: ["glutes", "legs"], equipment: [], level: "beginner", tags: [], prescription: reps(2, "8 / direction"), minutes: 3, cue: "Hold a wall, draw big slow circles." },
  { id: "shoulder_cars", name: "Shoulder circles", category: "mobility", muscles: ["shoulders"], equipment: [], level: "beginner", tags: [], prescription: reps(2, "5 / direction"), minutes: 3, cue: "Slow, full range, ribs still." },
  { id: "standing_hamstring", name: "Standing hamstring stretch", category: "mobility", muscles: ["legs"], equipment: [], level: "beginner", tags: [], prescription: hold(2, 30), minutes: 3, cue: "Heel on a low step, hinge forward." },
];

/**
 * More movements people log from their own routines. Users can pick these in
 * the movement picker; Pivot's planner doesn't schedule them on its own, so
 * generated plans and their evals stay as they were.
 */
export const EXTRA_EXERCISES: Exercise[] = [
  // ----- Strength: gym -----
  { id: "hip_thrust", name: "Barbell hip thrust", category: "strength", muscles: ["glutes", "legs"], equipment: ["barbell", "bench"], level: "intermediate", tags: ["heavy_barbell"], prescription: reps(4, "8–10"), minutes: 9, cue: "Chin tucked, ribs down, drive the hips to lockout." },
  { id: "front_squat", name: "Barbell front squat", category: "strength", muscles: ["legs", "glutes", "core"], equipment: ["barbell", "squat_rack"], level: "advanced", tags: ["heavy_barbell"], prescription: reps(4, "5–6"), minutes: 12, cue: "Elbows high, sit straight down between your heels." },
  { id: "barbell_row", name: "Barbell row", category: "strength", muscles: ["back", "arms"], equipment: ["barbell"], level: "intermediate", tags: ["heavy_barbell"], prescription: reps(4, "6–8"), minutes: 9, cue: "Hinge to about 45°, pull the bar to your lower ribs." },
  { id: "incline_db_press", name: "Incline dumbbell press", category: "strength", muscles: ["chest", "shoulders", "arms"], equipment: ["dumbbells", "bench"], level: "beginner", tags: [], prescription: reps(3, "8–12"), minutes: 7, cue: "Bench at 30°, lower to upper chest." },
  { id: "db_fly", name: "Dumbbell fly", category: "strength", muscles: ["chest"], equipment: ["dumbbells", "bench"], level: "beginner", tags: [], prescription: reps(3, "10–12"), minutes: 6, cue: "Soft elbows, open wide, hug back up." },
  { id: "chest_press_machine", name: "Machine chest press", category: "strength", muscles: ["chest", "arms", "shoulders"], equipment: ["machines"], level: "beginner", tags: [], prescription: reps(3, "10–12"), minutes: 6, cue: "Handles at mid-chest, press without locking out hard." },
  { id: "leg_press", name: "Leg press", category: "strength", muscles: ["legs", "glutes"], equipment: ["machines"], level: "beginner", tags: [], prescription: reps(3, "10–12"), minutes: 7, cue: "Feet hip-width, lower until hips start to tuck." },
  { id: "leg_curl", name: "Leg curl", category: "strength", muscles: ["legs"], equipment: ["machines"], level: "beginner", tags: [], prescription: reps(3, "10–12"), minutes: 6, cue: "Curl smoothly, slow on the way back." },
  { id: "leg_extension", name: "Leg extension", category: "strength", muscles: ["legs"], equipment: ["machines"], level: "beginner", tags: [], prescription: reps(3, "12–15"), minutes: 5, cue: "Pause at the top, control the lowering." },
  { id: "tricep_pushdown", name: "Cable triceps pushdown", category: "strength", muscles: ["arms"], equipment: ["cable_machine"], level: "beginner", tags: [], prescription: reps(3, "10–15"), minutes: 5, cue: "Elbows pinned to your sides." },
  { id: "chin_up", name: "Chin-up", category: "strength", muscles: ["back", "arms"], equipment: ["pull_up_bar"], level: "intermediate", tags: [], prescription: reps(4, "5–8"), minutes: 8, cue: "Palms toward you, chest up to the bar." },
  { id: "hanging_knee_raise", name: "Hanging knee raise", category: "strength", muscles: ["core"], equipment: ["pull_up_bar"], level: "intermediate", tags: [], prescription: reps(3, "10–12"), minutes: 5, cue: "No swinging; curl the pelvis up." },

  // ----- Strength: dumbbells, bench & bodyweight -----
  { id: "bulgarian_split_squat", name: "Bulgarian split squat", category: "strength", muscles: ["legs", "glutes"], equipment: ["dumbbells", "bench"], level: "intermediate", tags: [], prescription: reps(3, "8 / side"), minutes: 8, cue: "Back foot on the bench, front shin stays steady." },
  { id: "walking_lunge", name: "Walking lunge", category: "strength", muscles: ["legs", "glutes"], equipment: ["dumbbells"], level: "beginner", tags: [], prescription: reps(3, "10 / side"), minutes: 7, cue: "Long steps, torso tall." },
  { id: "hammer_curl", name: "Hammer curl", category: "strength", muscles: ["arms"], equipment: ["dumbbells"], level: "beginner", tags: [], prescription: reps(3, "10–12"), minutes: 5, cue: "Thumbs up, elbows still." },
  { id: "overhead_tricep_ext", name: "Overhead triceps extension", category: "strength", muscles: ["arms"], equipment: ["dumbbells"], level: "beginner", tags: ["overhead"], prescription: reps(3, "10–12"), minutes: 5, cue: "Elbows point up; lower behind your head." },
  { id: "arnold_press", name: "Arnold press", category: "strength", muscles: ["shoulders", "arms"], equipment: ["dumbbells"], level: "intermediate", tags: ["overhead"], prescription: reps(3, "8–10"), minutes: 6, cue: "Rotate palms out as you press." },
  { id: "rear_delt_fly", name: "Rear-delt fly", category: "strength", muscles: ["shoulders", "back"], equipment: ["dumbbells"], level: "beginner", tags: [], prescription: reps(3, "12–15"), minutes: 5, cue: "Hinge forward, lead with the elbows." },
  { id: "db_shrug", name: "Dumbbell shrug", category: "strength", muscles: ["back", "shoulders"], equipment: ["dumbbells"], level: "beginner", tags: [], prescription: reps(3, "12–15"), minutes: 4, cue: "Straight up toward your ears, pause." },
  { id: "bench_dip", name: "Bench dip", category: "strength", muscles: ["arms", "chest"], equipment: ["bench"], level: "beginner", tags: [], prescription: reps(3, "10–12"), minutes: 5, cue: "Shoulders down, elbows point back." },
  { id: "calf_raise", name: "Standing calf raise", category: "strength", muscles: ["legs"], equipment: [], level: "beginner", tags: [], prescription: reps(3, "15–20"), minutes: 4, cue: "Full stretch at the bottom, pause at the top." },
  { id: "side_plank", name: "Side plank", category: "strength", muscles: ["core"], equipment: [], level: "beginner", tags: ["floor_work"], prescription: hold(2, 30), minutes: 4, cue: "Hips high, body in one line. Both sides." },
  { id: "russian_twist", name: "Russian twist", category: "strength", muscles: ["core"], equipment: [], level: "beginner", tags: ["floor_work"], prescription: reps(3, "12 / side"), minutes: 4, cue: "Lean back slightly, rotate from the ribs." },

  // ----- Cardio, HIIT & mobility -----
  { id: "elliptical", name: "Elliptical", category: "cardio", muscles: ["legs", "full_body"], equipment: ["machines"], level: "beginner", tags: [], prescription: duration(25), minutes: 25, cue: "Steady effort, stand tall." },
  { id: "stair_climber", name: "Stair climber", category: "cardio", muscles: ["legs", "glutes"], equipment: ["machines"], level: "beginner", tags: [], prescription: duration(20), minutes: 20, cue: "Light touch on the rails, full steps." },
  { id: "jumping_jacks", name: "Jumping jacks", category: "hiit", muscles: ["full_body"], equipment: [], level: "beginner", tags: ["high_impact"], prescription: hold(4, 40), minutes: 5, cue: "Land softly on the balls of your feet." },
  { id: "couch_stretch", name: "Couch stretch", category: "mobility", muscles: ["legs", "glutes"], equipment: [], level: "beginner", tags: ["floor_work"], prescription: hold(2, 45), minutes: 4, cue: "Back knee down, squeeze the glute of that leg." },
];

/** Everything a user can pick: the planner's catalog plus the extras. */
export const ALL_EXERCISES: Exercise[] = [...EXERCISES, ...EXTRA_EXERCISES];

export const EXERCISES_BY_ID: Record<string, Exercise> = Object.fromEntries(
  ALL_EXERCISES.map((e) => [e.id, e]),
);

export function getExercise(id: string): Exercise | undefined {
  return EXERCISES_BY_ID[id];
}

/**
 * A form-demo link for an exercise. This is a YouTube search, not a specific
 * video, so it can never point at a dead or made-up URL.
 */
export function demoVideoUrl(ex: Pick<Exercise, "name" | "category">): string {
  const suffix = ex.category === "cardio" ? "beginner guide" : "exercise proper form";
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${ex.name} ${suffix}`)}`;
}
