/**
 * Movement guides: what good form looks like, in words the model reads and in
 * numbers the code checks.
 *
 * Each guide has a plain-language description (setup, phases, checkpoints)
 * that goes into the agent's context, and fault rules over the per-rep
 * features in `analyze.ts`. The model may only report faults that a rule or
 * the golden comparison actually found, and may only name causes listed here.
 *
 * Thresholds are starting points for a 2D side view, not clinical standards.
 * Calibrate them against the golden set (`npm run form:eval`) before trusting
 * them, and record every change.
 */
import type { CameraView } from "./pose";

/** Per-rep measurements computed in analyze.ts. Angles in degrees, distances as a fraction of leg length. */
export const FEATURES = {
  min_knee_angle: "Smallest knee angle in the rep (180 = straight leg). Lower = deeper.",
  min_hip_angle: "Smallest angle between torso and thigh. Lower = more hip bend.",
  min_elbow_angle: "Smallest elbow angle in the rep. Lower = deeper push-up.",
  max_elbow_angle: "Largest elbow angle in the rep. Near 180 = full lockout.",
  torso_lean_at_bottom: "Torso angle from vertical at the deepest point. Higher = more forward lean.",
  max_torso_lean: "Largest torso angle from vertical during the rep. From the front it is estimated from how much shorter the torso looks as it tips toward the camera.",
  hip_depth_at_bottom: "Hip height relative to the knee at the bottom, as a fraction of thigh length. Positive = hip below knee.",
  hip_drop_ratio: "Front view: how far the hips drop at the bottom, as a share of their standing height above the ankles. About 0.5 or more = thighs at parallel.",
  max_heel_lift: "How far the heel rises from its starting height, as a fraction of leg length.",
  max_hip_sag: "Largest drop of the hips below the shoulder-ankle line, in degrees (push-up).",
  max_hip_pike: "Largest rise of the hips above the shoulder-ankle line, in degrees (push-up).",
  knee_ankle_width_ratio: "Knee spread divided by ankle spread at the bottom (front view only). Below 1 = knees moving in.",
  descent_s: "Seconds from the top to the bottom of the rep.",
  ascent_s: "Seconds from the bottom back to the top.",
  rom_deg: "Range of motion of the movement's main joint, in degrees.",
} as const;
export type FeatureId = keyof typeof FEATURES;

/** Which joint angle drives rep counting. "Down" means the angle gets smaller. */
export type PrimarySignal = "knee" | "hip" | "elbow" | "min_knee";

export interface Cause {
  id: string;
  label: string;
  /** What in the data or history would point to this cause. Shown to the model. */
  signals: string;
}

export interface Fix {
  kind: "regression" | "drill" | "load" | "cue";
  /** Catalog exercise id for regressions, DRILLS id for drills. */
  ref?: string;
  text: string;
}

export interface FaultRule {
  id: string;
  label: string;
  feature: FeatureId;
  op: "<" | ">";
  threshold: number;
  /** The camera angle that can see this fault. Defaults to side; rules run only on reps filmed from that angle. "any" runs on both. */
  view?: CameraView | "any";
  severity: "minor" | "moderate" | "major";
  meaning: string;
  causes: Cause[];
  cues: string[];
  fixes: Fix[];
}

export interface MovementGuide {
  id: string;
  name: string;
  /** Catalog exercises this guide covers. */
  exerciseIds: string[];
  view: CameraView;
  primary: PrimarySignal;
  /** Minimum range of the primary angle for a rep to count. */
  minRomDeg: number;
  recording: string;
  description: string;
  phases: string[];
  checkpoints: string[];
  features: FeatureId[];
  faults: FaultRule[];
  /** What 2D keypoints from this view cannot tell us. The model must say so, not guess. */
  cannotAssess: string[];
}

/** Short corrective drills that aren't full catalog exercises. */
export const DRILLS: Record<string, { name: string; how: string; equipment: string[] }> = {
  ankle_rocks: { name: "Kneeling ankle rocks", how: "Half-kneel, drive the front knee past the toes with the heel down, 10 per side.", equipment: [] },
  box_squat_to_target: { name: "Squat to a box or chair", how: "Sit lightly to a target at the depth you want, then stand. Lower the target over weeks.", equipment: [] },
  goblet_hold_squat: { name: "Goblet squat pause", how: "Hold a light weight at the chest, pause 3 s at the bottom, chest tall.", equipment: ["dumbbells"] },
  tempo_squat: { name: "Tempo squat", how: "3 s down, 1 s pause, normal speed up, with a lighter load.", equipment: [] },
  wall_hip_hinge: { name: "Wall hip hinge", how: "Stand a foot from a wall and push the hips back to touch it, shins nearly vertical.", equipment: [] },
  dowel_hinge: { name: "Dowel hinge", how: "Hold a stick along your spine touching head, upper back and tailbone; hinge without losing any contact.", equipment: [] },
  plank_hold: { name: "Plank with glute squeeze", how: "30 s forearm plank, squeeze glutes and pull ribs down.", equipment: [] },
  eccentric_push_up: { name: "Slow-lowering push-up", how: "Lower for 3–4 s in one straight line, reset from the knees.", equipment: [] },
  split_stance_hold: { name: "Split-stance hold", how: "Hold the bottom of a split squat for 20 s, torso tall, front heel down.", equipment: [] },
};

const SQUAT: MovementGuide = {
  id: "squat",
  name: "Squat",
  exerciseIds: ["bw_squat", "goblet_squat", "back_squat", "band_squat"],
  view: "side",
  primary: "knee",
  minRomDeg: 35,
  recording: "Phone at hip height, 2–3 m away, filming exactly from the side. Whole body in frame, including feet.",
  description:
    "Feet about shoulder width, toes slightly out. Brace, then sit the hips down and back while the knees travel forward over the toes. Keep the whole foot on the floor and the chest up. Reach at least thigh-parallel depth if mobility allows, then drive up through the whole foot, hips and chest rising together.",
  phases: [
    "Setup: stand tall, brace the core, weight over midfoot.",
    "Descent: hips and knees bend together, controlled, about 1–3 s.",
    "Bottom: hip crease at or below knee height, heels down, torso angle stable.",
    "Ascent: hips and chest rise at the same rate; finish standing tall.",
  ],
  checkpoints: ["Depth at or below parallel", "Heels stay down", "Torso lean moderate and steady", "Knees track over toes (front view)"],
  features: ["min_knee_angle", "hip_depth_at_bottom", "hip_drop_ratio", "torso_lean_at_bottom", "max_torso_lean", "max_heel_lift", "knee_ankle_width_ratio", "descent_s", "ascent_s", "rom_deg"],
  faults: [
    {
      id: "squat_shallow",
      label: "Above-parallel depth",
      feature: "min_knee_angle",
      op: ">",
      threshold: 105,
      severity: "moderate",
      meaning: "The rep stops before the thighs reach parallel.",
      causes: [
        { id: "ankle_mobility", label: "Limited ankle mobility", signals: "Shallow from the first rep and often paired with heel lift or a big forward lean." },
        { id: "load_too_heavy", label: "Load too heavy", signals: "Depth was fine at lighter loads or in earlier sessions, and this session's load went up." },
        { id: "fatigue", label: "Fatigue", signals: "Early reps reach depth and the last reps get shallower or slower." },
        { id: "technique_unfamiliar", label: "Unfamiliar with the pattern", signals: "Beginner, consistent across all reps, no load change." },
      ],
      cues: ["Sit down between your heels, not just back.", "Aim your hips at a chair just below knee height."],
      fixes: [
        { kind: "drill", ref: "box_squat_to_target", text: "Squat to a target at the depth you want." },
        { kind: "drill", ref: "ankle_rocks", text: "Ankle rocks before squatting." },
        { kind: "load", text: "Drop the load 10–20% until depth is consistent." },
      ],
    },
    {
      id: "squat_shallow_front",
      label: "Shallow depth (front view)",
      feature: "hip_drop_ratio",
      op: "<",
      threshold: 0.45,
      view: "front",
      severity: "moderate",
      meaning: "Seen from the front, the hips drop less than about half of their standing height, which means the thighs stop above parallel.",
      causes: [
        { id: "ankle_mobility", label: "Limited ankle mobility", signals: "Shallow from the first rep and often paired with heel lift or a big forward lean." },
        { id: "load_too_heavy", label: "Load too heavy", signals: "Depth was fine at lighter loads or in earlier sessions, and this session's load went up." },
        { id: "fatigue", label: "Fatigue", signals: "Early reps reach depth and the last reps get shallower or slower." },
        { id: "technique_unfamiliar", label: "Unfamiliar with the pattern", signals: "Beginner, consistent across all reps, no load change." },
      ],
      cues: ["Sit down between your heels, not just back.", "Aim your hips at a chair just below knee height."],
      fixes: [
        { kind: "drill", ref: "box_squat_to_target", text: "Squat to a target at the depth you want." },
        { kind: "drill", ref: "ankle_rocks", text: "Ankle rocks before squatting." },
        { kind: "load", text: "Drop the load 10–20% until depth is consistent." },
      ],
    },
    {
      id: "squat_forward_lean",
      label: "Excessive forward lean",
      feature: "max_torso_lean",
      op: ">",
      threshold: 55,
      view: "any",
      severity: "moderate",
      meaning: "The chest drops far forward at the bottom, shifting load to the lower back.",
      causes: [
        { id: "ankle_mobility", label: "Limited ankle mobility", signals: "Shins stay near vertical so the torso has to tip forward to keep balance." },
        { id: "load_too_heavy", label: "Load too heavy", signals: "Lean increases with load or appears after a load jump." },
        { id: "fatigue", label: "Fatigue", signals: "Lean grows over the set." },
        { id: "weak_upper_back", label: "Upper back or core not braced", signals: "Lean is worst on the way up (hips rise first)." },
      ],
      cues: ["Show your shirt logo to the wall in front of you.", "Brace before each rep."],
      fixes: [
        { kind: "regression", ref: "goblet_squat", text: "Goblet squat keeps the torso more upright." },
        { kind: "drill", ref: "goblet_hold_squat", text: "Paused goblet squats to own the bottom position." },
        { kind: "load", text: "Reduce load until the lean stays under control." },
      ],
    },
    {
      id: "squat_heel_lift",
      label: "Heels lifting",
      feature: "max_heel_lift",
      op: ">",
      threshold: 0.04,
      severity: "minor",
      meaning: "Weight shifts to the toes as the heels come off the floor.",
      causes: [
        { id: "ankle_mobility", label: "Limited ankle mobility", signals: "Heels lift at the bottom, every rep." },
        { id: "balance_forward", label: "Weight too far forward", signals: "Heels lift early in the descent." },
      ],
      cues: ["Keep three points of the foot on the floor: heel, big toe, little toe."],
      fixes: [
        { kind: "drill", ref: "ankle_rocks", text: "Ankle rocks before squatting." },
        { kind: "drill", ref: "box_squat_to_target", text: "Squat to a target with weight in the heels." },
      ],
    },
    {
      id: "squat_knee_valgus",
      label: "Knees caving in",
      feature: "knee_ankle_width_ratio",
      op: "<",
      threshold: 0.85,
      view: "front",
      severity: "moderate",
      meaning: "The knees move inside the line of the feet.",
      causes: [
        { id: "load_too_heavy", label: "Load too heavy", signals: "Appears with a load increase or only on the hardest reps." },
        { id: "fatigue", label: "Fatigue", signals: "Gets worse in the last reps." },
        { id: "technique_unfamiliar", label: "Not cued yet", signals: "Consistent from the first rep at a light load." },
      ],
      cues: ["Spread the floor with your feet.", "Knees follow your middle toes."],
      fixes: [
        { kind: "regression", ref: "band_squat", text: "Banded squat, lighter." },
        { kind: "drill", ref: "tempo_squat", text: "Slow tempo squats while watching the knees." },
        { kind: "load", text: "Reduce load 10–20%." },
      ],
    },
  ],
  cannotAssess: ["Lower-back rounding (2D points cannot see spine curvature)", "Knee tracking from the side view (needs a front view)", "Bar path for barbell squats"],
};

const HINGE: MovementGuide = {
  id: "hinge",
  name: "Hip hinge (Romanian deadlift)",
  exerciseIds: ["db_rdl", "deadlift", "kb_swing"],
  view: "side",
  primary: "hip",
  minRomDeg: 30,
  recording: "Phone at hip height, filming exactly from the side, whole body in frame.",
  description:
    "Stand tall with soft knees. Push the hips straight back while the torso tips forward as one rigid piece. The knees bend only slightly and the shins stay close to vertical. The weight stays close to the legs. Lower until you feel a strong hamstring stretch, usually mid-shin, then drive the hips forward to stand.",
  phases: [
    "Setup: tall, soft knees, ribs down, weight close.",
    "Hinge: hips move back, torso tips forward, knees barely change.",
    "Bottom: hamstrings loaded, back flat, weight around mid-shin.",
    "Return: squeeze glutes to bring the hips forward; don't lean back at the top.",
  ],
  checkpoints: ["Hips move back, not down", "Knees stay soft, not squatting", "Enough hip bend to load the hamstrings"],
  features: ["min_hip_angle", "min_knee_angle", "max_torso_lean", "descent_s", "ascent_s", "rom_deg"],
  faults: [
    {
      id: "hinge_squatting",
      label: "Squatting the hinge",
      feature: "min_knee_angle",
      op: "<",
      threshold: 135,
      severity: "moderate",
      meaning: "The knees bend a lot, so it turns into a squat and the hamstrings do less work.",
      causes: [
        { id: "technique_unfamiliar", label: "Hinge pattern not learned", signals: "Consistent across reps, beginner, no load change." },
        { id: "hamstring_flexibility", label: "Tight hamstrings", signals: "Knees bend more as the torso gets lower; range stays short." },
        { id: "load_too_heavy", label: "Load too heavy", signals: "Knee bend grows after a load increase." },
      ],
      cues: ["Close a car door behind you with your hips.", "Shins stay still; only the hips move back."],
      fixes: [
        { kind: "drill", ref: "wall_hip_hinge", text: "Wall hip hinge to learn the pattern." },
        { kind: "drill", ref: "dowel_hinge", text: "Dowel hinge for a neutral spine." },
        { kind: "regression", ref: "glute_bridge", text: "Glute bridge to train hip extension without the hinge." },
      ],
    },
    {
      id: "hinge_short_rom",
      label: "Not hinging far enough",
      feature: "min_hip_angle",
      op: ">",
      threshold: 125,
      severity: "minor",
      meaning: "The torso barely tips forward, so the hamstrings are never stretched under load.",
      causes: [
        { id: "hamstring_flexibility", label: "Tight hamstrings", signals: "Range is short every rep and the knees start bending to get lower." },
        { id: "fatigue", label: "Fatigue", signals: "Range shrinks across the set." },
        { id: "technique_unfamiliar", label: "Unsure how low to go", signals: "Consistently short with no other faults." },
      ],
      cues: ["Push the hips back until your hamstrings pull, then stand."],
      fixes: [
        { kind: "drill", ref: "wall_hip_hinge", text: "Move the wall farther away over time." },
        { kind: "load", text: "Use a lighter weight and a slower lowering phase." },
      ],
    },
  ],
  cannotAssess: ["Lower-back rounding (2D points cannot see spine curvature)", "How close the weight stays to the legs"],
};

const PUSH_UP: MovementGuide = {
  id: "push_up",
  name: "Push-up",
  exerciseIds: ["push_up", "incline_push_up"],
  view: "side",
  primary: "elbow",
  minRomDeg: 30,
  recording: "Phone on the floor 2 m away, filming exactly from the side, head to feet in frame.",
  description:
    "Hands slightly wider than shoulders, body in one straight line from head to heels. Brace the core and squeeze the glutes. Lower the chest toward the floor with elbows about 45° from the body until the elbows are at or below 90°, then press back to straight arms without the hips sagging or piking.",
  phases: [
    "Setup: high plank, straight line from shoulders to ankles.",
    "Lowering: whole body moves as one, 1–2 s.",
    "Bottom: elbows at or below 90°, chest near the floor.",
    "Press: push the floor away to full lockout, line stays straight.",
  ],
  checkpoints: ["Body stays in one line", "Elbows reach about 90°", "Full lockout at the top"],
  features: ["min_elbow_angle", "max_elbow_angle", "max_hip_sag", "max_hip_pike", "descent_s", "ascent_s", "rom_deg"],
  faults: [
    {
      id: "push_up_hip_sag",
      label: "Hips sagging",
      feature: "max_hip_sag",
      op: ">",
      threshold: 12,
      severity: "moderate",
      meaning: "The hips drop below the shoulder-ankle line, loading the lower back.",
      causes: [
        { id: "core_endurance", label: "Core endurance", signals: "Line is fine early and sags in later reps." },
        { id: "too_hard_variation", label: "Variation too hard", signals: "Sags from the first rep, short range, beginner." },
        { id: "not_braced", label: "Not bracing", signals: "Sags every rep even at a good range of motion." },
      ],
      cues: ["Squeeze your glutes and pull your ribs toward your hips."],
      fixes: [
        { kind: "regression", ref: "incline_push_up", text: "Incline push-up, hands on a bench or counter." },
        { kind: "drill", ref: "plank_hold", text: "Plank with a glute squeeze." },
      ],
    },
    {
      id: "push_up_pike",
      label: "Hips piking up",
      feature: "max_hip_pike",
      op: ">",
      threshold: 15,
      severity: "minor",
      meaning: "The hips rise above the line, shortening the work for the chest.",
      causes: [
        { id: "too_hard_variation", label: "Variation too hard", signals: "Pike grows as the set goes on or from the first rep with short range." },
        { id: "not_braced", label: "Not bracing", signals: "Consistent pike with full range." },
      ],
      cues: ["Push your heels back and keep your hips level with your shoulders."],
      fixes: [{ kind: "regression", ref: "incline_push_up", text: "Incline push-up to keep the line." }],
    },
    {
      id: "push_up_partial",
      label: "Partial range",
      feature: "min_elbow_angle",
      op: ">",
      threshold: 105,
      severity: "moderate",
      meaning: "The chest doesn't get low enough; elbows stay well above 90°.",
      causes: [
        { id: "too_hard_variation", label: "Variation too hard", signals: "Short from the first rep." },
        { id: "fatigue", label: "Fatigue", signals: "Range shrinks over the set." },
      ],
      cues: ["Lower until your chest is a fist's height from the floor."],
      fixes: [
        { kind: "regression", ref: "incline_push_up", text: "Incline push-up through full range." },
        { kind: "drill", ref: "eccentric_push_up", text: "Slow-lowering push-ups." },
      ],
    },
  ],
  cannotAssess: ["Elbow flare (needs a view from above or the front)", "Shoulder blade movement"],
};

const LUNGE: MovementGuide = {
  id: "lunge",
  name: "Lunge or split squat",
  exerciseIds: ["reverse_lunge", "db_split_squat", "step_up"],
  view: "side",
  primary: "min_knee",
  minRomDeg: 30,
  recording: "Phone at hip height, filming from the side of the front leg, whole body in frame.",
  description:
    "Long split stance. Keep the torso tall and lower the back knee straight down toward the floor. The front foot stays flat and the front knee travels over the toes. Go until the back knee is just above the floor, then drive up through the front foot.",
  phases: [
    "Setup: split stance, hip-width rails, torso tall.",
    "Lowering: back knee drops straight down.",
    "Bottom: front thigh near parallel, front heel down.",
    "Drive: push through the front foot to stand.",
  ],
  checkpoints: ["Front thigh reaches about parallel", "Torso stays fairly upright", "Front heel stays down"],
  features: ["min_knee_angle", "max_torso_lean", "max_heel_lift", "descent_s", "ascent_s", "rom_deg"],
  faults: [
    {
      id: "lunge_shallow",
      label: "Shallow lunge",
      feature: "min_knee_angle",
      op: ">",
      threshold: 110,
      severity: "moderate",
      meaning: "The front thigh stays well above parallel.",
      causes: [
        { id: "stance_too_short", label: "Stance too short", signals: "Front knee shoots forward early and range is short every rep." },
        { id: "fatigue", label: "Fatigue", signals: "Range shrinks across reps." },
        { id: "balance", label: "Balance", signals: "Uneven tempo, short range, beginner." },
      ],
      cues: ["Drop the back knee straight down like an elevator."],
      fixes: [
        { kind: "drill", ref: "split_stance_hold", text: "Split-stance holds at the bottom." },
        { kind: "regression", ref: "reverse_lunge", text: "Reverse lunge, bodyweight." },
      ],
    },
    {
      id: "lunge_forward_lean",
      label: "Leaning forward",
      feature: "max_torso_lean",
      op: ">",
      threshold: 30,
      severity: "minor",
      meaning: "The torso tips forward, shifting the work and the balance.",
      causes: [
        { id: "balance", label: "Balance", signals: "Lean varies a lot from rep to rep." },
        { id: "fatigue", label: "Fatigue", signals: "Lean grows across reps." },
      ],
      cues: ["Stay tall, like your head is pulled up by a string."],
      fixes: [{ kind: "drill", ref: "split_stance_hold", text: "Split-stance holds, torso tall." }],
    },
  ],
  cannotAssess: ["Front knee tracking inward (needs a front view)", "Which leg is in front if both legs overlap in the frame"],
};

export const MOVEMENTS: Record<string, MovementGuide> = { squat: SQUAT, hinge: HINGE, push_up: PUSH_UP, lunge: LUNGE };
export const MOVEMENT_IDS = Object.keys(MOVEMENTS) as [string, ...string[]];

export function getMovement(id: string): MovementGuide | undefined {
  return MOVEMENTS[id];
}

/** The guide that covers a catalog exercise, if any. */
export function movementForExercise(exerciseId: string): MovementGuide | undefined {
  return Object.values(MOVEMENTS).find((m) => m.exerciseIds.includes(exerciseId));
}

export function findFault(movement: MovementGuide, faultId: string): FaultRule | undefined {
  return movement.faults.find((f) => f.id === faultId);
}
