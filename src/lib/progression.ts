/**
 * Progressive overload from the user's own lift log.
 *
 * Pure and deterministic. Uses "double progression", the standard way to
 * progress within a rep range (ACSM 2009 position stand on progression models
 * in resistance training; NSCA Essentials, ch. 17):
 *
 * - Stay at a weight until every set reaches the top of the rep range.
 * - Then add a small load (about 2.5% upper body, 5% lower body, at least one
 *   plate or dumbbell step, within ACSM's 2–10%) and start back at the bottom
 *   of the range.
 * - Inside the range, add a rep per set next time.
 * - Under the bottom of the range: repeat the weight once; if it happens two
 *   sessions in a row, drop about 10% and build back up.
 *
 * Bodyweight movements add reps; timed holds add 5 seconds. These are general
 * suggestions, never medical advice.
 */
import { getExercise } from "./catalog";
import type { Exercise, ExerciseLog, IsoDate, LoggedSet, WeightUnit, WorkoutExercise } from "./schemas";

export interface Session {
  date: IsoDate;
  unit: WeightUnit;
  /** Sets actually logged, in order. */
  sets: LoggedSet[];
}

export type TargetKind = "first" | "increase_weight" | "add_reps" | "repeat" | "deload" | "add_seconds";

export interface Target {
  kind: TargetKind;
  sets: number;
  /** Reps per set, or seconds for timed holds. */
  reps: number;
  /** Load in `unit`; null for bodyweight or when it's the user's first time. */
  weight: number | null;
  unit: WeightUnit;
  timed: boolean;
  /** One plain-language sentence: why this target. */
  reason: string;
}

/** Movements we log sets for: anything counted in reps or held for seconds (not timed cardio blocks). */
export function isLoggable(we: WorkoutExercise): boolean {
  if (we.minutes) return false;
  const p = getExercise(we.exerciseId)?.prescription;
  return p ? p.kind !== "duration" : Boolean(we.sets);
}

export function isTimed(we: WorkoutExercise): boolean {
  if (we.seconds) return true;
  return getExercise(we.exerciseId)?.prescription.kind === "hold";
}

/** Whether a movement is normally loaded (so we ask for a weight). Bands and bodyweight aren't. */
export function usesWeight(ex: Exercise | undefined): boolean {
  if (!ex) return true;
  return ex.equipment.some((e) => ["dumbbells", "kettlebell", "barbell", "cable_machine"].includes(e));
}

/** "8–12" → {lo 8, hi 12}; "10 / side" → {10, 10}. */
export function parseRepRange(text: string | undefined): { lo: number; hi: number } | null {
  if (!text) return null;
  const range = text.match(/(\d+)\s*[–—-]\s*(\d+)/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    return { lo: Math.min(a, b), hi: Math.max(a, b) };
  }
  const one = text.match(/(\d+)/);
  return one ? { lo: Number(one[1]), hi: Number(one[1]) } : null;
}

/** Prescribed sets and rep range (or seconds) for a movement in a workout. */
export function prescribed(we: WorkoutExercise): { sets: number; lo: number; hi: number; timed: boolean } {
  const p = getExercise(we.exerciseId)?.prescription;
  const timed = isTimed(we);
  const sets = we.sets ?? (p && p.kind !== "duration" ? p.sets : 3);
  if (timed) {
    const s = we.seconds ?? (p?.kind === "hold" ? p.seconds : 30);
    return { sets, lo: s, hi: s, timed };
  }
  const range = parseRepRange(we.reps) ?? parseRepRange(p?.kind === "reps" ? p.reps : undefined) ?? { lo: 8, hi: 12 };
  return { sets, ...range, timed };
}

const LB_PER_KG = 2.20462;

export function convert(weight: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return weight;
  return from === "kg" ? weight * LB_PER_KG : weight / LB_PER_KG;
}

/** Smallest practical jump: one dumbbell or plate step. */
export function loadStep(ex: Exercise | undefined, unit: WeightUnit): number {
  const dumbbell = ex?.equipment.some((e) => e === "dumbbells" || e === "kettlebell");
  if (unit === "kg") return dumbbell ? 2 : 2.5;
  return 5;
}

function isLowerBody(ex: Exercise | undefined): boolean {
  return Boolean(ex?.muscles.some((m) => m === "legs" || m === "glutes"));
}

function roundTo(x: number, step: number): number {
  return Math.round(x / step) * step;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/** "10, 10, 9 reps @ 25 lb" or "3 × 10 @ 25 lb". */
export function formatSets(sets: LoggedSet[], unit: WeightUnit, timed = false): string {
  if (!sets.length) return "";
  const per = timed ? "s" : "";
  const reps = sets.map((s) => s.reps);
  const weights = [...new Set(sets.map((s) => s.weight ?? 0))];
  const sameReps = reps.every((r) => r === reps[0]);
  const repText = sameReps ? `${sets.length} × ${reps[0]}${per}` : `${reps.join(", ")}${timed ? " s" : " reps"}`;
  if (weights.length === 1) return weights[0] ? `${repText} @ ${fmt(weights[0])} ${unit}` : repText;
  return sets.map((s) => `${s.reps}${per}${s.weight ? ` @ ${fmt(s.weight)}` : ""}`).join(", ") + ` ${unit}`;
}

/** Estimated one-rep max for the best set (Epley). Null when nothing weighted was logged. */
export function estimatedMax(sets: LoggedSet[]): number | null {
  let best: number | null = null;
  for (const s of sets) {
    if (!s.weight || s.reps < 1) continue;
    const e = s.reps === 1 ? s.weight : s.weight * (1 + s.reps / 30);
    if (best === null || e > best) best = e;
  }
  return best;
}

/**
 * Past sessions for one exercise, newest first. Only sessions before `before`
 * count, so today's half-logged session never moves today's target.
 */
export function sessionsFor(lifts: ExerciseLog[], exerciseId: string, before: IsoDate): Session[] {
  return lifts
    .filter((l) => l.exerciseId === exerciseId && l.date < before)
    .map((l) => ({ date: l.date, unit: l.unit, at: l.at, sets: l.sets.filter((s): s is LoggedSet => !!s && s.reps > 0) }))
    .filter((s) => s.sets.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at))
    .map(({ date, unit, sets }) => ({ date, unit, sets }));
}

/** The weight most sets were done at (ties → heavier), converted to `unit`. */
function workingWeight(s: Session, unit: WeightUnit): number | null {
  const counts = new Map<number, number>();
  for (const set of s.sets) if (set.weight) counts.set(set.weight, (counts.get(set.weight) ?? 0) + 1);
  if (!counts.size) return null;
  const [w] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  return convert(w, s.unit, unit);
}

function setsAt(s: Session, weight: number, unit: WeightUnit): LoggedSet[] {
  return s.sets.filter((x) => x.weight && Math.abs(convert(x.weight, s.unit, unit) - weight) < 0.6);
}

/** Next session's target for one movement, from its history (newest first). */
export function suggestTarget(we: WorkoutExercise, history: Session[], unit: WeightUnit): Target {
  const ex = getExercise(we.exerciseId);
  const rx = prescribed(we);
  const { sets, lo, hi, timed } = rx;
  const rangeText = lo === hi ? `${lo}` : `${lo}–${hi}`;
  const last = history[0];

  if (!last) {
    return {
      kind: "first",
      sets,
      reps: timed || usesWeight(ex) ? lo : hi,
      weight: null,
      unit,
      timed,
      reason: timed
        ? `First time logging this. Hold for ${lo} s each set and log how long you lasted.`
        : usesWeight(ex)
          ? `First time logging this. Pick a weight you could lift for ${rangeText} reps with about 2 reps left in the tank, then log it.`
          : `First time logging this. Do ${rangeText} reps each set and log what you got.`,
    };
  }

  const lastText = formatSets(last.sets, last.unit, timed);

  if (timed) {
    const allHit = last.sets.length >= sets && last.sets.every((s) => s.reps >= lo);
    const best = Math.min(...last.sets.map((s) => s.reps));
    return allHit
      ? { kind: "add_seconds", sets, reps: Math.max(lo, best) + 5, weight: null, unit, timed, reason: `You held every set last time (${lastText}). Add 5 seconds.` }
      : { kind: "repeat", sets, reps: lo, weight: null, unit, timed, reason: `Last time: ${lastText}. Aim for the full ${lo} s on every set before adding time.` };
  }

  const w = workingWeight(last, unit);

  // Bodyweight or band work: progress with reps.
  if (w === null) {
    const minReps = Math.min(...last.sets.map((s) => s.reps));
    const complete = last.sets.length >= sets;
    if (complete && minReps >= hi) {
      return { kind: "add_reps", sets, reps: minReps + 2, weight: null, unit, timed, reason: `You hit ${hi}+ on every set last time (${lastText}). Go for ${minReps + 2}, or slow the lowering to 3 seconds.` };
    }
    if (minReps < lo) {
      return { kind: "repeat", sets, reps: lo, weight: null, unit, timed, reason: `Last time: ${lastText}. Aim for ${lo} on every set.` };
    }
    const reps = Math.min(hi, minReps + 1);
    return { kind: "add_reps", sets, reps, weight: null, unit, timed, reason: `Last time: ${lastText}. Add a rep: ${reps} per set.` };
  }

  const working = setsAt(last, w, unit);
  const reps = working.map((s) => s.reps);
  const minReps = Math.min(...reps);
  const step = loadStep(ex, unit);
  const wText = `${fmt(roundTo(w, unit === "kg" ? 0.5 : 1))} ${unit}`;

  if (working.length >= sets && minReps >= hi) {
    const pct = isLowerBody(ex) ? 0.05 : 0.025;
    const inc = Math.max(step, roundTo(w * pct, step));
    const next = roundTo(w + inc, step) > w ? roundTo(w + inc, step) : w + inc;
    return {
      kind: "increase_weight",
      sets,
      reps: lo,
      weight: next,
      unit,
      timed,
      reason: `You hit ${hi} reps on every set at ${wText} last time. Add ${fmt(next - w)} ${unit} and start back at ${lo} reps.`,
    };
  }

  if (minReps < lo) {
    const prev = history[1];
    const prevW = prev ? workingWeight(prev, unit) : null;
    const missedTwice =
      prev && prevW !== null && Math.abs(prevW - w) < 0.6 && setsAt(prev, w, unit).some((s) => s.reps < lo);
    if (missedTwice) {
      const lighter = Math.max(step, Math.floor((w * 0.9) / step) * step);
      return {
        kind: "deload",
        sets,
        reps: lo,
        weight: lighter,
        unit,
        timed,
        reason: `Two sessions in a row under ${lo} reps at ${wText}. Drop to ${fmt(lighter)} ${unit} (about 10% lighter) and build back up.`,
      };
    }
    return { kind: "repeat", sets, reps: lo, weight: w, unit, timed, reason: `Last time: ${lastText}. Stay at ${wText} and aim for ${lo} on every set.` };
  }

  const target = Math.min(hi, minReps + 1);
  return {
    kind: "add_reps",
    sets,
    reps: target,
    weight: w,
    unit,
    timed,
    reason: `Last time: ${lastText}. Same weight, aim for ${target} reps per set. Once every set reaches ${hi}, add weight.`,
  };
}

/** Short target label, e.g. "3 × 8 @ 30 lb" or "3 × 35 s". */
export function formatTarget(t: Target): string {
  const per = t.timed ? " s" : "";
  return `${t.sets} × ${t.reps}${per}${t.weight ? ` @ ${fmt(t.weight)} ${t.unit}` : ""}`;
}
