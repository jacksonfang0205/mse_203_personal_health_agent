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
  MUSCLE_LABELS,
  TIME_OF_DAY,
  WEEKDAY_LABELS,
  WORKOUT_TYPE_LABELS,
} from "@/lib/labels";
import {
  AVOID_TAGS,
  EQUIPMENT,
  EXPERIENCE_LEVELS,
  FitnessProfile,
  GOALS,
  MUSCLE_GROUPS,
  TIMES_OF_DAY,
  WEEKDAYS,
  WORKOUT_TYPES,
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

export function finalizeDraft(d: ProfileDraft, updatedAt: string) {
  return FitnessProfile.safeParse({ ...d, name: d.name?.trim() || undefined, version: 1, updatedAt });
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
      <Field label="Any areas you want to focus on?" hint="Optional. Leave blank for a balanced mix.">
        <div className="flex flex-wrap gap-2">
          {MUSCLE_GROUPS.map((m) => (
            <Chip
              key={m}
              selected={draft.targetMuscles.includes(m)}
              onClick={() => set({ targetMuscles: toggle(draft.targetMuscles, m) })}
            >
              {MUSCLE_LABELS[m]}
            </Chip>
          ))}
        </div>
      </Field>
    </div>
  );
}

export function StyleSection({ draft, set }: SectionProps) {
  return (
    <div className="flex flex-col gap-8">
      <Field label="How would you describe your experience?">
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
      <Field label="What do you actually enjoy?" hint="Pivot leans on these when it plans and when it suggests swaps.">
        <div className="flex flex-wrap gap-2">
          {WORKOUT_TYPES.map((t) => (
            <Chip
              key={t}
              selected={draft.workoutTypes.includes(t)}
              onClick={() => set({ workoutTypes: toggle(draft.workoutTypes, t) })}
            >
              {WORKOUT_TYPE_LABELS[t]}
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
      <Field label="Anything Pivot should steer around?" hint="Pivot will never schedule these.">
        <div className="grid gap-3 sm:grid-cols-2">
          {AVOID_TAGS.map((t) => (
            <OptionCard
              key={t}
              selected={draft.avoidTags.includes(t)}
              onClick={() => set({ avoidTags: toggle(draft.avoidTags, t) })}
              title={AVOID_TAG_LABELS[t].label}
              blurb={AVOID_TAG_LABELS[t].blurb}
            />
          ))}
        </div>
      </Field>

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
    </div>
  );
}

/** Per-step completeness, shared by onboarding and the preferences page. */
export const SECTION_CHECKS = {
  goals: (d: ProfileDraft) => (d.goals.length ? null : "Pick at least one goal."),
  style: (d: ProfileDraft) => (d.workoutTypes.length ? null : "Pick at least one kind of workout."),
  equipment: () => null,
  schedule: (d: ProfileDraft) =>
    !d.preferredDays.length ? "Pick at least one day." : !d.preferredTimes.length ? "Pick at least one time of day." : null,
  boundaries: () => null,
} satisfies Record<string, (d: ProfileDraft) => string | null>;
