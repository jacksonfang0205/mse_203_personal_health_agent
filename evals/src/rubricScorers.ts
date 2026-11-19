/**
 * The five plan-quality scorers from evals/rubric.md, as pure functions.
 * Each returns { name, score (0–1, or null for N/A), metadata: { reason } }.
 * All five are deterministic code checks; none needs an LLM judge.
 */
import { getExercise } from "@/lib/catalog";
import type { ExperienceLevel, Workout } from "@/lib/schemas";
import { addDays, overlaps, toMinutes } from "@/lib/time";

// ---------- Case shape (evals/cases.json) ----------

export interface CaseBusy {
  date: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  title: string;
  source?: string;
}

export interface CaseProfile {
  experience: ExperienceLevel;
  goals: string[];
  goalNotes?: string;
  equipment: string[];
  sessionMinutes: number;
  frequencyPerWeek: number;
  preferredDays: string[];
  preferredTimes: string[];
  avoidTags: string[];
  avoidExerciseIds: string[];
  avoidNotes: string;
  limitations: string;
}

export interface PriorWeek {
  completed: { date: string; durationMin: number; category: string }[];
  highestLevelUsed?: ExperienceLevel;
  lastCompletedDate?: string;
}

export interface RubricCase {
  id: string;
  type: string;
  title: string;
  description: string;
  now: { date: string; time: string };
  profile: CaseProfile;
  calendar: CaseBusy[];
  priorWeek: PriorWeek | null;
  userMessage?: string;
  timeZone?: string;
  expected: {
    calendar: { outcome: "plan" | "infeasible" };
    notes?: string;
    [k: string]: unknown;
  };
}

/** What the task returns for one case. */
export interface PlanOutput {
  workouts: Workout[];
  /** The "can't be done" message (Life Happens infeasibleReason), if any. */
  infeasibleReason?: string;
  notes: string[];
}

export interface ScoreResult {
  name: string;
  score: number | null;
  metadata: { reason: string };
}

// ---------- Shared helpers ----------

const RANK: Record<ExperienceLevel, number> = { beginner: 0, intermediate: 1, advanced: 2 };
const round = (x: number) => Math.round(x * 100) / 100;
const result = (name: string, score: number | null, reason: string): ScoreResult => ({
  name,
  score: score === null ? null : round(Math.max(0, Math.min(1, score))),
  metadata: { reason },
});
const dayLabel = (date: string) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7];

function planned(out: PlanOutput, weekStart: string): Workout[] {
  return out.workouts.filter((w) => w.status === "planned" && w.date >= weekStart && w.date <= addDays(weekStart, 6));
}

function entries(ws: Workout[]) {
  return ws.flatMap((w) => w.exercises.map((e) => ({ w, e, ex: getExercise(e.exerciseId) })));
}

function defaultSets(exerciseId: string): number | undefined {
  const p = getExercise(exerciseId)?.prescription;
  return p && p.kind !== "duration" ? p.sets : undefined;
}

// ---------- 5. Injury: body parts and forbidden exercises (rubric tables) ----------

export type BodyPart = "knee" | "shoulder" | "lower_back";

const PART_WORDS: Record<BodyPart, RegExp> = {
  knee: /\b(knee|knees|kneecap|patella\w*)\b/i,
  shoulder: /\b(shoulder|shoulders|rotator|impingement)\b/i,
  lower_back: /\b(lower back|low back|back pain|lumbar|spine)\b/i,
};
const PROBLEM = /\b(hurt\w*|pain\w*|sore|weird|injur\w*|strain\w*|tweak\w*|tendon\w*|acting up|swollen|bad|impingement|physio)\b/i;

export const FORBIDDEN: Record<BodyPart, string[]> = {
  knee: ["bw_squat", "goblet_squat", "band_squat", "back_squat", "wall_sit", "reverse_lunge", "db_split_squat", "step_up", "low_lunge", "warrior_flow", "pigeon_pose", "squat_jump", "jump_rope", "burpee", "easy_run", "run_intervals"],
  shoulder: ["db_shoulder_press", "overhead_press", "bench_press", "db_bench", "db_floor_press", "band_chest_press", "push_up", "incline_push_up", "pull_up", "db_lateral_raise", "mountain_climber", "burpee", "sun_salutation"],
  lower_back: ["deadlift", "back_squat", "db_rdl", "kb_swing", "row_steady", "burpee", "pilates_roll_up", "pilates_swimming"],
};

/** Injured parts named with a problem word in setup text or the user's message. */
export function injuredParts(c: RubricCase): BodyPart[] {
  const text = [c.profile.limitations, c.profile.avoidNotes, c.userMessage ?? ""].join("\n");
  const sentences = text.split(/[.!?\n]/);
  return (Object.keys(PART_WORDS) as BodyPart[]).filter((part) =>
    sentences.some((s) => PART_WORDS[part].test(s) && PROBLEM.test(s)),
  );
}

// ---------- 1. Capability ----------

export function capability(c: RubricCase, out: PlanOutput, weekStart: string): ScoreResult {
  const es = entries(planned(out, weekStart));
  if (!es.length) {
    return c.expected.calendar.outcome === "infeasible"
      ? result("capability", null, "N/A: no workouts, and the case expects none.")
      : result("capability", 0, "No workouts planned where a plan was expected.");
  }
  const have = new Set(c.profile.equipment);
  const bad: string[] = [];
  for (const { w, e, ex } of es) {
    const why = !ex
      ? "not in the catalog"
      : RANK[ex.level] > RANK[c.profile.experience]
        ? `${ex.level}, user is ${c.profile.experience}`
        : ex.equipment.some((q) => !have.has(q))
          ? `needs ${ex.equipment.filter((q) => !have.has(q)).join(", ")}`
          : e.sets && defaultSets(e.exerciseId) !== undefined && e.sets > defaultSets(e.exerciseId)! + 1
            ? `${e.sets} sets vs default ${defaultSets(e.exerciseId)}`
            : null;
    if (why) bad.push(`${dayLabel(w.date)}: ${e.exerciseId} (${why})`);
  }
  const score = 1 - bad.length / es.length;
  return result("capability", score, bad.length ? `${bad.slice(0, 3).join("; ")} — ${bad.length} of ${es.length} entries.` : `All ${es.length} entries within level and equipment.`);
}

// ---------- 2. Calendar ----------

const SAYS_NO_TIME = /no (free )?time|can'?t fit|cannot fit|no room|fully booked|no (free |open )?(slot|window)|nothing fits|not possible|isn'?t possible/i;

export function calendar(c: RubricCase, out: PlanOutput, weekStart: string): ScoreResult {
  const ws = planned(out, weekStart);
  if (c.expected.calendar.outcome === "infeasible") {
    const message = [out.infeasibleReason ?? "", ...out.notes].join(" ");
    if (ws.length) return result("calendar", 0, `Impossible week, but ${ws.length} workout(s) scheduled (first: ${dayLabel(ws[0].date)} ${ws[0].start}).`);
    return SAYS_NO_TIME.test(message)
      ? result("calendar", 1, `Nothing scheduled and it says so: "${message.slice(0, 90)}".`)
      : result("calendar", 0, "Nothing scheduled, but it never says there's no time.");
  }
  const allDay = new Set(c.calendar.filter((b) => b.allDay).map((b) => b.date));
  for (const w of ws) {
    const s = toMinutes(w.start);
    const e = s + w.durationMin;
    if (allDay.has(w.date)) return result("calendar", 0, `${dayLabel(w.date)} ${w.start} ${w.title} is on an all-day busy day.`);
    const hit = c.calendar.find((b) => !b.allDay && b.date === w.date && overlaps(s, e, toMinutes(b.start!), toMinutes(b.end!)));
    if (hit) return result("calendar", 0, `${dayLabel(w.date)} ${w.start}–${w.durationMin}m ${w.title} overlaps ${hit.start}–${hit.end} "${hit.title}".`);
    if (s < 360 || e > 1320) return result("calendar", 0, `${dayLabel(w.date)} ${w.start} ${w.title} is outside 06:00–22:00.`);
    if (`${w.date} ${w.start}` < `${c.now.date} ${c.now.time}`) return result("calendar", 0, `${dayLabel(w.date)} ${w.start} ${w.title} is in the past.`);
  }
  return result("calendar", 1, ws.length ? `No clashes across ${ws.length} workouts.` : "No workouts, so no clashes.");
}

// ---------- 3. Diversity ----------

const GROUPS = ["chest", "back", "shoulders", "arms", "core", "glutes", "legs"];
const primary = (m: string) => (m === "full_body" ? "legs" : m);

export function diversity(c: RubricCase, out: PlanOutput, weekStart: string, allowedIds: string[]): ScoreResult {
  const ws = planned(out, weekStart);
  const es = entries(ws);
  if (!es.length) return result("diversity", null, "N/A: no workouts.");
  const ids = es.map((x) => x.e.exerciseId);
  const a = new Set(ids).size / ids.length;
  if (ws.length < 2) return result("diversity", a, `One workout: ${new Set(ids).size} distinct of ${ids.length} entries.`);
  const trained = new Set(es.flatMap((x) => (x.ex ? [primary(x.ex.muscles[0])] : [])).filter((g) => GROUPS.includes(g)));
  const available = new Set(allowedIds.flatMap((id) => { const ex = getExercise(id); return ex ? [primary(ex.muscles[0])] : []; }).filter((g) => GROUPS.includes(g)));
  const b = Math.min(1, trained.size / Math.max(1, Math.min(5, available.size)));
  const repeats = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  const missing = [...available].filter((g) => !trained.has(g));
  return result(
    "diversity",
    0.5 * a + 0.5 * b,
    `A=${round(a)} (${new Set(ids).size}/${ids.length} distinct${repeats.length ? `; repeated ${repeats.slice(0, 3).join(", ")}` : ""}), B=${round(b)} (${[...trained].join(", ")}${missing.length ? `; missing ${missing.join(", ")}` : ""}).`,
  );
}

// ---------- 4. Progression ----------

export function progression(c: RubricCase, out: PlanOutput, weekStart: string): ScoreResult {
  const ws = planned(out, weekStart);
  const es = entries(ws);
  if (!ws.length) return result("progression", null, "N/A: no workouts.");
  const load = ws.reduce((s, w) => s + w.durationMin, 0);
  const recent = (c.priorWeek?.completed ?? []).filter((x) => x.date >= addDays(weekStart, -14));
  const lastWeek = recent.filter((x) => x.date >= addDays(weekStart, -7));
  let score: number;
  let reason: string;
  if (lastWeek.length) {
    const base = lastWeek.reduce((s, x) => s + x.durationMin, 0);
    const r = load / base;
    score = r <= 1.1 ? 1 : r >= 1.3 ? 0 : 1 - (r - 1.1) / 0.2;
    reason = `Continuing: ${load} min vs ${base} last week (${r >= 1 ? "+" : ""}${Math.round((r - 1) * 100)}%).`;
  } else {
    const target = c.profile.frequencyPerWeek * c.profile.sessionMinutes;
    score = load <= 0.67 * target ? 1 : load >= target ? 0 : 1 - (load - 0.67 * target) / (0.33 * target);
    reason = `${c.priorWeek?.lastCompletedDate ? "Returning after a break" : "New user"}: ${load} min vs cap ${Math.round(0.67 * target)} (target ${target}).`;
    const extraSets = es.filter((x) => x.e.sets && defaultSets(x.e.exerciseId) !== undefined && x.e.sets > defaultSets(x.e.exerciseId)!);
    if (extraSets.length) {
      score *= 0.5;
      reason += ` Above default sets: ${extraSets.map((x) => x.e.exerciseId).slice(0, 2).join(", ")} (×0.5).`;
    }
  }
  const prevLevel = c.priorWeek?.highestLevelUsed;
  if (prevLevel) {
    const jump = es.find((x) => x.ex && RANK[x.ex.level] - RANK[prevLevel] > 1);
    if (jump) {
      score *= 0.5;
      reason += ` Level jump: ${jump.e.exerciseId} (${jump.ex!.level}) after ${prevLevel} (×0.5).`;
    }
  }
  return result("progression", score, reason);
}

// ---------- 5. Injury ----------

export function injury(c: RubricCase, out: PlanOutput, weekStart: string): ScoreResult {
  const parts = injuredParts(c);
  if (!parts.length) return result("injury", null, "N/A: no injury stated.");
  const es = entries(planned(out, weekStart));
  if (!es.length) return result("injury", 1, `${parts.join(", ")}: nothing scheduled.`);
  const forbidden = new Set(parts.flatMap((p) => FORBIDDEN[p]));
  const hits = es.filter((x) => forbidden.has(x.e.exerciseId));
  const score = 1 - hits.length / es.length;
  return result(
    "injury",
    score,
    hits.length
      ? `${parts.join(", ")}: ${hits.slice(0, 3).map((x) => `${x.e.exerciseId} (${dayLabel(x.w.date)})`).join(", ")}. Critical.`
      : `${parts.join(", ")}: no forbidden exercises in ${es.length} entries.`,
  );
}
