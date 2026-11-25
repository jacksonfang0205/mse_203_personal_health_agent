/**
 * Injuries and things to avoid, in the user's own words, mapped to the avoid
 * tags the validator enforces. Used by the Preferences form (limitations and
 * avoid notes) and by the coach chat, which saves an injury the user
 * mentions and swaps out exercises that conflict with it.
 *
 * Pivot never diagnoses or prescribes rehab; it only steers away from
 * movements that load the area the user named.
 */
import { getExercise } from "./catalog";
import { allowedCategories, buildWorkout, eligibleExercises, filterFromProfile } from "./planner/generate";
import { AVOID_TAG_LABELS } from "./labels";
import type { AvoidTag, FitnessProfile, IsoDate, MemoryNote, WeeklyPlan, Workout, WorkoutExercise } from "./schemas";
import { formatDate } from "./time";

/** Activities named directly ("no running", "nothing overhead"). */
const AVOID_WORDS: [AvoidTag, RegExp][] = [
  ["running", /\b(run|runs|running|jog|jogging)\b/i],
  ["high_impact", /\b(jump\w*|plyo\w*|high[- ]impact|impact|burpees?|hop\w*)\b/i],
  ["overhead", /\b(overhead|shoulders?)\b/i],
  ["floor_work", /\b(floor|kneel\w*|lying down|on the ground)\b/i],
  ["heavy_barbell", /\b(barbells?|heavy (lifts?|lifting|weights?)|deadlifts?|weight ?lifting)\b/i],
];
// Only a negative phrase counts, so "I love running" doesn't rule out running.
const NEGATIVE = /\b(no|not|never|avoid\w*|can'?t|cannot|don'?t|won'?t|hate\w*|skip|without|stay away|injur\w*|hurt\w*|pain\w*|sore|bad|tweak\w*|strain\w*)\b/i;

export function avoidTagsFromText(text: string): AvoidTag[] {
  const clauses = text.replace(/’/g, "'").split(/[.;,\n]|\bbut\b/i);
  const out = new Set<AvoidTag>();
  for (const c of clauses) {
    if (!NEGATIVE.test(c)) continue;
    for (const [tag, re] of AVOID_WORDS) if (re.test(c)) out.add(tag);
  }
  return [...out];
}

/** A hurt body part, and the tagged movements that load it. */
const BODY_PARTS: { label: string; re: RegExp; tags: AvoidTag[] }[] = [
  { label: "shin", re: /\bshins?\b|shin ?splints?/i, tags: ["running", "high_impact"] },
  { label: "ankle", re: /\bankles?\b|achilles/i, tags: ["running", "high_impact"] },
  { label: "foot", re: /\b(foot|feet|heels?|plantar|arch)\b/i, tags: ["running", "high_impact"] },
  { label: "calf", re: /\bcal(f|ves)\b/i, tags: ["running", "high_impact"] },
  { label: "knee", re: /\bknees?\b/i, tags: ["running", "high_impact"] },
  { label: "hip", re: /\bhips?\b/i, tags: ["running", "high_impact"] },
  { label: "shoulder", re: /\bshoulders?\b|rotator cuff/i, tags: ["overhead"] },
  { label: "wrist", re: /\bwrists?\b/i, tags: ["floor_work"] },
  { label: "lower back", re: /\b(lower|low) back\b|\bmy back\b|\bback (pain|hurts?|injury|is sore)\b/i, tags: ["heavy_barbell"] },
];
const HURT = /\b(pain\w*|hurt\w*|injur\w*|sore\w*|ache\w*|aching|sprain\w*|strain\w*|tweak\w*|pulled|splints?|tendinitis|tendonitis|inflamed|swollen)\b/i;
const RESOLVED = /\b(no longer|not anymore|healed|better now|all better|recovered|gone now|no pain)\b/i;

export interface InjuryMention {
  /** Short phrase saved to Preferences, e.g. "Shin pain". */
  label: string;
  /** Avoid tags the plan has to respect from now on. */
  tags: AvoidTag[];
}

/** Detects an injury or pain the user mentions in chat ("my shin hurts", "shin splints"). */
export function detectInjury(message: string): InjuryMention | null {
  const text = message.replace(/’/g, "'");
  if (!HURT.test(text) || RESOLVED.test(text)) return null;
  const parts = BODY_PARTS.filter((p) => p.re.test(text));
  const tags = new Set<AvoidTag>([...parts.flatMap((p) => p.tags), ...avoidTagsFromText(text)]);
  if (!parts.length && !tags.size) return null;
  const word = text.match(HURT)?.[0].toLowerCase() ?? "pain";
  const kind = /splint/.test(word) ? "splints" : /injur/.test(word) ? "injury" : /sore/.test(word) ? "soreness" : /sprain|strain|tweak|pulled/.test(word) ? "strain" : "pain";
  const where = parts.map((p) => p.label).join(" and ");
  const label = where ? `${where.charAt(0).toUpperCase()}${where.slice(1)} ${kind}` : `Pain (${message.trim().slice(0, 60)})`;
  return { label, tags: [...tags] };
}

/**
 * The profile with an injury saved to the limitations field (shown on the
 * Preferences page) and its tags added to what Pivot enforces. Idempotent.
 */
export function withInjury(profile: FitnessProfile, injury: InjuryMention, today: IsoDate): FitnessProfile {
  const already = profile.limitations.toLowerCase().includes(injury.label.toLowerCase());
  const line = `${injury.label} (from coach chat, ${formatDate(today)})`;
  const limitations = already ? profile.limitations : [profile.limitations.trim(), line].filter(Boolean).join("\n").slice(0, 500);
  const avoidTags = [...new Set([...profile.avoidTags, ...injury.tags])];
  return { ...profile, limitations, avoidTags };
}

/**
 * The injury as a coach-memory note ("Notes for Pivot"), which the coach and
 * the planner read on every later turn. Null when memory already has it, so
 * mentioning the same injury twice doesn't add a duplicate.
 */
export function injuryMemoryNote(injury: InjuryMention, notes: MemoryNote[], today: IsoDate, at = new Date().toISOString()): MemoryNote | null {
  const key = injury.label.toLowerCase();
  if (notes.some((n) => n.text.toLowerCase().includes(key))) return null;
  const avoid = injury.tags.map((t) => AVOID_TAG_LABELS[t].label.toLowerCase());
  const text = `Injury: ${key}${avoid.length ? `. Avoid ${avoid.join(" and ")}` : ""} (told the coach ${formatDate(today)}).`;
  return { id: crypto.randomUUID(), text: text.slice(0, 300), source: "agent", createdAt: at };
}

export interface InjurySwap {
  workoutId: string;
  title: string;
  date: IsoDate;
  /** Exercise names taken out, and what replaced them (if anything). */
  removed: string[];
  added: string[];
}

const conflicts = (we: WorkoutExercise, tags: Set<AvoidTag>, ids: Set<string>) => {
  const ex = getExercise(we.exerciseId);
  return !!ex && (ids.has(ex.id) || ex.tags.some((t) => tags.has(t)));
};

/**
 * Drop or swap exercises in upcoming planned workouts that conflict with the
 * profile's avoid tags. Each workout keeps its day, start and length. A
 * conflicting exercise is swapped for an eligible one in the same category
 * that trains a shared muscle, or dropped; a session left empty (a run, say)
 * is rebuilt in the same or another allowed format.
 */
export function removeConflictingExercises(plan: WeeklyPlan, profile: FitnessProfile, today: IsoDate): { plan: WeeklyPlan; swaps: InjurySwap[] } {
  const tags = new Set(profile.avoidTags);
  const ids = new Set(profile.avoidExerciseIds);
  const filter = filterFromProfile(profile);
  const swaps: InjurySwap[] = [];
  const workouts = plan.workouts.map((w): Workout => {
    if (w.status !== "planned" || w.date < today || !w.exercises.some((we) => conflicts(we, tags, ids))) return w;
    const removed: string[] = [];
    const added: string[] = [];
    const used = new Set(w.exercises.map((we) => we.exerciseId));
    const pool = eligibleExercises(w.category, filter);
    const exercises: WorkoutExercise[] = [];
    for (const we of w.exercises) {
      if (!conflicts(we, tags, ids)) {
        exercises.push(we);
        continue;
      }
      const ex = getExercise(we.exerciseId)!;
      removed.push(ex.name);
      const sub = pool.find((p) => !used.has(p.id) && p.muscles.some((m) => ex.muscles.includes(m)) && p.prescription.kind === ex.prescription.kind);
      if (sub) {
        used.add(sub.id);
        added.push(sub.name);
        const rx = sub.prescription;
        exercises.push(
          rx.kind === "duration"
            ? { exerciseId: sub.id, minutes: we.minutes ?? rx.minutes }
            : rx.kind === "hold"
              ? { exerciseId: sub.id, sets: rx.sets, seconds: rx.seconds }
              : { exerciseId: sub.id, sets: rx.sets, reps: rx.reps },
        );
      }
    }
    let next: Workout | null = exercises.length
      ? (() => {
          const list = exercises.map((we) => getExercise(we.exerciseId)!).filter(Boolean);
          return { ...w, exercises, muscles: [...new Set(list.flatMap((e) => e.muscles))], equipment: [...new Set(list.flatMap((e) => e.equipment))] };
        })()
      : null;
    if (!next) {
      // Nothing left: rebuild the slot in the same format if possible, else another allowed one.
      for (const category of [w.category, ...allowedCategories(profile, filter).filter((c) => c !== w.category)]) {
        next = buildWorkout({
          category,
          focus: w.muscles,
          minutes: w.durationMin,
          filter,
          workoutTypes: profile.workoutTypes,
          id: w.id,
          date: w.date,
          start: w.start,
          origin: w.origin,
          rationale: `Swapped in because of what you told your coach. ${w.rationale}`.slice(0, 300),
        });
        if (next) break;
      }
      if (next) added.push(...next.exercises.map((we) => getExercise(we.exerciseId)?.name ?? we.exerciseId));
    }
    if (!next) return w;
    swaps.push({ workoutId: w.id, title: w.title, date: w.date, removed, added });
    return next;
  });
  return { plan: { ...plan, workouts }, swaps };
}

/** "Swapped Easy run for Brisk walk on Thu, Nov 20." */
export function describeSwaps(swaps: InjurySwap[]): string {
  return swaps
    .map((s) =>
      s.added.length
        ? `Swapped ${s.removed.join(", ")} for ${s.added.join(", ")} on ${formatDate(s.date)}.`
        : `Dropped ${s.removed.join(", ")} from ${s.title} on ${formatDate(s.date)}.`,
    )
    .join(" ");
}
