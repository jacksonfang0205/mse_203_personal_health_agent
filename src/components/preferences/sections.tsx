"use client";

/**
 * Preference form sections, shared by onboarding (one per step) and the
 * Preferences page (all at once).
 */
import { useState, type ReactNode } from "react";
import { EXERCISES } from "@/lib/catalog";
import {
  AVOID_TAG_LABELS,
  EQUIPMENT_LABELS,
  EQUIPMENT_PRESETS,
  EXPERIENCE_LABELS,
  GOAL_LABELS,
  TIME_OF_DAY,
  WEEKDAY_LABELS,
  WORKOUT_TYPE_LABELS,
} from "@/lib/labels";
import {
  type AvoidTag,
  EQUIPMENT,
  EXPERIENCE_LEVELS,
  FitnessProfile,
  GOALS,
  type Goal,
  TIMES_OF_DAY,
  WEEKDAYS,
} from "@/lib/schemas";
import { Chip, OptionCard, cx } from "../ui";

export type ProfileDraft = Omit<FitnessProfile, "version" | "updatedAt">;

export const DEFAULT_DRAFT: ProfileDraft = {
  name: "",
  goals: [],
  targetMuscles: [],
  experience: "beginner",
  workoutTypes: [],
  equipment: [],
  sessionMinutes: 45,
  frequencyPerWeek: 3,
  preferredDays: [],
  preferredTimes: [],
  avoidTags: [],
  avoidExerciseIds: [],
  avoidNotes: "",
  limitations: "",
};

export function draftFromProfile(p: FitnessProfile): ProfileDraft {
  const { version: _v, updatedAt: _u, ...rest } = p;
  void _v;
  void _u;
  return { ...rest, name: rest.name ?? "" };
}

/** Quick-pick goals implied by a goal typed in the user's own words. */
const GOAL_WORDS: [Goal, RegExp][] = [
  ["fat_loss", /lose (weight|fat)|fat loss|burn fat|lean(er)?\b|slim|weight loss|cut\b/i],
  ["strength", /strong|strength|muscle|lift|bulk|tone|pull-?up|push-?up|squat|bench/i],
  ["endurance", /run|marathon|\b\d+\s?k\b|endurance|cardio|stamina|hike|cycl|bike|swim|row/i],
  ["mobility", /flexib|mobil|stretch|posture|yoga|pilates|back pain|stiff|range of motion/i],
  ["stress_relief", /stress|relax|calm|anxi|mental|sleep|mood/i],
];

export function goalsFromText(text: string): Goal[] {
  return GOAL_WORDS.filter(([, re]) => re.test(text)).map(([g]) => g);
}

/** Things to avoid, in the user's words, mapped to the tags validation can enforce. */
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

export function finalizeDraft(d: ProfileDraft, updatedAt: string) {
  const goalNotes = d.goalNotes?.trim() || undefined;
  // A goal typed in words is enough: pick the closest quick-picks so the template planner has something to go on.
  const goals = d.goals.length
    ? d.goals
    : goalNotes
      ? goalsFromText(goalNotes).length
        ? goalsFromText(goalNotes)
        : ["general_fitness" as Goal]
      : [];
  const extraEquipment = d.extraEquipment?.length ? d.extraEquipment : undefined;
  // What the user wrote about things to avoid becomes restrictions the schedule checks enforce.
  const avoidTags = [...new Set([...d.avoidTags, ...avoidTagsFromText(`${d.avoidNotes}\n${d.limitations}`)])];
  return FitnessProfile.safeParse({
    ...d,
    goals,
    avoidTags,
    goalNotes,
    extraEquipment,
    name: d.name?.trim() || undefined,
    version: 1,
    updatedAt,
  });
}

export interface SectionProps {
  draft: ProfileDraft;
  set: (patch: Partial<ProfileDraft>) => void;
  /** Onboarding only: jump to another step. */
  jump?: (step: number) => void;
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold text-ink">{label}</span>
        {hint && <span className="text-sm text-ink-soft">{hint}</span>}
      </legend>
      {children}
    </fieldset>
  );
}

export function GoalsSection({ draft, set }: SectionProps) {
  return (
    <div className="flex flex-col gap-8">
      <Field label="What are you working toward?" hint="Pick one or more.">
        <div className="grid gap-3 sm:grid-cols-2">
          {GOALS.map((g) => (
            <OptionCard
              key={g}
              selected={draft.goals.includes(g)}
              onClick={() => set({ goals: toggle(draft.goals, g) })}
              title={GOAL_LABELS[g].label}
              blurb={GOAL_LABELS[g].blurb}
            />
          ))}
        </div>
      </Field>
    </div>
  );
}

/** Experience level. Not asked during setup (it defaults to beginner, the safe choice); editable in Preferences. */
export function ExperienceSection({ draft, set }: SectionProps) {
  return (
    <Field label="Experience level" hint="Sets how advanced the exercises can be. New profiles start at beginner.">
      <div className="grid gap-3 sm:grid-cols-3">
        {EXPERIENCE_LEVELS.map((lvl) => (
          <OptionCard
            key={lvl}
            selected={draft.experience === lvl}
            onClick={() => set({ experience: lvl })}
            title={EXPERIENCE_LABELS[lvl].label}
            blurb={EXPERIENCE_LABELS[lvl].blurb}
          />
        ))}
      </div>
    </Field>
  );
}

/**
 * Activities offered in "What do you actually enjoy?". Gym vs home is already covered by the equipment
 * question, and group classes don't change the plan, so strength is one option ("gym" internally).
 */
const ENJOY_OPTIONS = ["gym", "running", "cycling", "walking", "hiit", "pilates", "yoga"] as const;
const ENJOY_LABELS: Partial<Record<(typeof ENJOY_OPTIONS)[number], string>> = { gym: "Strength training" };

export function StyleSection({ draft, set }: SectionProps) {
  return (
    <div className="flex flex-col gap-8">
      <Field label="What do you actually enjoy?" hint="Pivot leans on these when it plans and when it suggests swaps.">
        <div className="flex flex-wrap gap-2">
          {ENJOY_OPTIONS.map((t) => (
            <Chip
              key={t}
              selected={draft.workoutTypes.includes(t)}
              onClick={() => set({ workoutTypes: toggle(draft.workoutTypes, t) })}
            >
              {ENJOY_LABELS[t] ?? WORKOUT_TYPE_LABELS[t]}
            </Chip>
          ))}
        </div>
      </Field>
    </div>
  );
}

export function EquipmentSection({ draft, set }: SectionProps) {
  return (
    <Field label="What equipment can you reliably use?" hint="Bodyweight exercises are always on the table.">
      <div className="flex flex-wrap gap-2">
        {EQUIPMENT_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => set({ equipment: p.items })}
            className="rounded-full bg-paper-deep px-3.5 py-1.5 text-xs font-semibold text-ink-soft hover:text-ink"
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {EQUIPMENT.map((e) => (
          <Chip key={e} selected={draft.equipment.includes(e)} onClick={() => set({ equipment: toggle(draft.equipment, e) })}>
            {EQUIPMENT_LABELS[e]}
          </Chip>
        ))}
      </div>
    </Field>
  );
}

const DURATIONS = [20, 30, 45, 60, 75, 90];

export function ScheduleSection({ draft, set }: SectionProps) {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-8 sm:grid-cols-2">
        <Field label="How long is a typical session?" hint="Pivot won't plan anything longer.">
          <div className="flex flex-wrap gap-2">
            {DURATIONS.map((m) => (
              <Chip key={m} selected={draft.sessionMinutes === m} onClick={() => set({ sessionMinutes: m })}>
                {m} min
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="How many workouts a week?">
          <div className="flex items-center gap-4">
            <StepButton
              label="Fewer workouts"
              disabled={draft.frequencyPerWeek <= 1}
              onClick={() => set({ frequencyPerWeek: draft.frequencyPerWeek - 1 })}
            >
              −
            </StepButton>
            <span className="w-16 text-center font-display text-4xl font-semibold tabular-nums">{draft.frequencyPerWeek}</span>
            <StepButton
              label="More workouts"
              disabled={draft.frequencyPerWeek >= 7}
              onClick={() => set({ frequencyPerWeek: draft.frequencyPerWeek + 1 })}
            >
              +
            </StepButton>
          </div>
        </Field>
      </div>
      <Field label="Which days usually work best?">
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <Chip
              key={d}
              selected={draft.preferredDays.includes(d)}
              onClick={() => set({ preferredDays: toggle(draft.preferredDays, d) })}
              className="min-w-14 justify-center"
            >
              {WEEKDAY_LABELS[d].short}
            </Chip>
          ))}
        </div>
      </Field>
      <Field label="And what times of day?">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {TIMES_OF_DAY.map((t) => (
            <OptionCard
              key={t}
              selected={draft.preferredTimes.includes(t)}
              onClick={() => set({ preferredTimes: toggle(draft.preferredTimes, t) })}
              title={TIME_OF_DAY[t].label}
              blurb={TIME_OF_DAY[t].range}
            />
          ))}
        </div>
      </Field>
    </div>
  );
}

function StepButton(props: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className="grid h-11 w-11 place-items-center rounded-full border border-line-strong bg-card text-xl text-ink transition hover:border-ink disabled:opacity-30"
    >
      {props.children}
    </button>
  );
}

export function BoundariesSection({ draft, set }: SectionProps) {
  const [query, setQuery] = useState("");
  const matches = query.trim()
    ? EXERCISES.filter(
        (e) => e.name.toLowerCase().includes(query.trim().toLowerCase()) && !draft.avoidExerciseIds.includes(e.id),
      ).slice(0, 6)
    : [];
  const inputClass =
    "w-full rounded-2xl border border-line-strong bg-card px-4 py-3 text-sm placeholder:text-ink-faint focus:border-ink focus:outline-none";

  return (
    <div className="flex flex-col gap-8">
      <Field label="Specific exercises to skip" hint="Search Pivot's exercise library.">
        <input
          className={inputClass}
          placeholder="e.g. burpee, lunge, deadlift"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search exercises to avoid"
        />
        {matches.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {matches.map((e) => (
              <Chip
                key={e.id}
                selected={false}
                onClick={() => {
                  set({ avoidExerciseIds: [...draft.avoidExerciseIds, e.id] });
                  setQuery("");
                }}
              >
                + {e.name}
              </Chip>
            ))}
          </div>
        )}
        {draft.avoidExerciseIds.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {draft.avoidExerciseIds.map((id) => (
              <Chip key={id} selected onClick={() => set({ avoidExerciseIds: draft.avoidExerciseIds.filter((x) => x !== id) })}>
                {EXERCISES.find((e) => e.id === id)?.name ?? id} <span aria-hidden>×</span>
              </Chip>
            ))}
          </div>
        )}
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-[15px] font-semibold">Other things you&apos;d rather avoid</span>
          <textarea
            className={cx(inputClass, "min-h-24")}
            maxLength={500}
            placeholder="e.g. crowded gyms on weekends, early mornings after late labs"
            value={draft.avoidNotes}
            onChange={(e) => set({ avoidNotes: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-[15px] font-semibold">Physical limitations (optional)</span>
          <textarea
            className={cx(inputClass, "min-h-24")}
            maxLength={500}
            placeholder="Only what you're comfortable sharing"
            value={draft.limitations}
            onChange={(e) => set({ limitations: e.target.value })}
          />
          <span className="text-xs text-ink-faint">
            Pivot uses this to steer away from movements, not to give medical or rehab advice. For pain or injuries, check with a
            clinician.
          </span>
        </label>
      </div>
      <AvoidPreview draft={draft} set={set} />
    </div>
  );
}

/** What Pivot will enforce: restrictions read from the text above, plus any saved earlier (removable). */
function AvoidPreview({ draft, set }: SectionProps) {
  const fromText = avoidTagsFromText(`${draft.avoidNotes}\n${draft.limitations}`);
  const tags = [...new Set([...draft.avoidTags, ...fromText])];
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-ink-soft">Pivot will avoid:</span>
      {tags.map((t) =>
        fromText.includes(t) ? (
          <span key={t} className="rounded-full bg-ink/5 px-3 py-1" title="From what you wrote above">
            {AVOID_TAG_LABELS[t].label}
          </span>
        ) : (
          <Chip key={t} selected onClick={() => set({ avoidTags: draft.avoidTags.filter((x) => x !== t) })}>
            {AVOID_TAG_LABELS[t].label} <span aria-hidden>×</span>
          </Chip>
        ),
      )}
    </div>
  );
}

/** Per-step completeness, shared by onboarding and the preferences page. */
export const SECTION_CHECKS = {
  goals: (d: ProfileDraft) => (d.goals.length || d.goalNotes?.trim() ? null : "Describe your goal or pick one."),
  style: (d: ProfileDraft) => (d.workoutTypes.length ? null : "Pick at least one kind of workout."),
  equipment: () => null,
  schedule: (d: ProfileDraft) =>
    !d.preferredDays.length ? "Pick at least one day." : !d.preferredTimes.length ? "Pick at least one time of day." : null,
  boundaries: () => null,
} satisfies Record<string, (d: ProfileDraft) => string | null>;
