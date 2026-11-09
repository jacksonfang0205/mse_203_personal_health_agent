"use client";

import { useState, type ReactNode } from "react";
import { CALENDAR_PRESETS, CALENDAR_PRESET_IDS, type CalendarPresetId } from "@/lib/calendar";
import { EQUIPMENT_PRESETS, GOAL_LABELS, MUSCLE_LABELS, TIME_OF_DAY, WEEKDAY_LABELS } from "@/lib/labels";
import { GOALS, MUSCLE_GROUPS, TIMES_OF_DAY, WEEKDAYS, type Equipment, type FitnessProfile } from "@/lib/schemas";
import { buildSamplePlan, carryOver } from "@/lib/session";
import { pivot, usePivotState, type AppState } from "@/lib/store";
import { clearEvents, downloadJson, getEvents, track } from "@/lib/telemetry";
import { isAllDay } from "@/lib/memoryRules";
import { localNow } from "@/lib/time";
import { Check } from "../icons";
import { Button, ButtonLink, Card, Chip, Eyebrow, OptionCard, Skeleton, cx } from "../ui";
import { BlockedEditor, NotesEditor, Removable, useLearned } from "./MemorySection";
import {
  BoundariesSection,
  EquipmentSection,
  Field,
  SECTION_CHECKS,
  StyleSection,
  draftFromProfile,
  finalizeDraft,
  type ProfileDraft,
} from "./sections";

export function PreferencesEditor() {
  const state = usePivotState();
  if (!state) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-12">
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (!state.profile) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-5 px-5 py-24 text-center">
        <h1 className="font-display text-4xl font-medium">No preferences yet.</h1>
        <p className="text-ink-soft">Set up your profile first, then come back here to fine-tune it.</p>
        <ButtonLink href="/onboarding">Get started</ButtonLink>
      </div>
    );
  }
  // Re-key on save so the form re-initializes from the stored profile.
  return <Editor key={state.profile.updatedAt} profile={state.profile} state={state} />;
}

function Editor({ profile, state }: { profile: FitnessProfile; state: AppState }) {
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(profile));
  const [calendar, setCalendar] = useState<CalendarPresetId>(state.calendarPreset);
  const [rebuild, setRebuild] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [minutesText, setMinutesText] = useState<string | null>(null);
  const learned = useLearned(state);

  const set = (patch: Partial<ProfileDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
    setError(null);
  };

  const save = () => {
    const problem = Object.values(SECTION_CHECKS)
      .map((check) => check(draft))
      .find(Boolean);
    if (problem) {
      setError(problem);
      return;
    }
    const at = new Date();
    const parsed = finalizeDraft(draft, at.toISOString());
    if (!parsed.success) {
      setError("Some preferences are invalid.");
      return;
    }
    pivot.setCalendarPreset(calendar);
    if (rebuild) {
      const keep = carryOver(state.plan, localNow(at).date);
      pivot.setPlan(
        buildSamplePlan({
          profile: parsed.data,
          preset: calendar,
          now: localNow(at),
          createdAt: at.toISOString(),
          keep,
          blocked: state.blocked,
        }),
      );
    }
    pivot.saveProfile(parsed.data);
    track("preferences_saved", { rebuilt: rebuild });
    setSaved(true);
  };

  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const preset = (items: Equipment[]) =>
    items.length === draft.equipment.length && items.every((e) => draft.equipment.includes(e));
  const presetId = EQUIPMENT_PRESETS.find((p) => preset(p.items))?.id;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-10 sm:px-8">
      <header>
        <Eyebrow>Preferences</Eyebrow>
        <h1 className="mt-2 font-display text-4xl font-medium tracking-tight">Your plan basics</h1>
        <p className="mt-2 text-ink-soft">Just what Pivot needs to plan your week. Change anything, then save.</p>
      </header>

      <Card className="divide-y divide-line">
        <Row label="Goal">
          <div className="flex w-full flex-col gap-2.5">
            <input
              className={TEXT}
              value={draft.goalNotes ?? ""}
              maxLength={300}
              placeholder="In your words, e.g. run a 10K by spring without getting hurt"
              onChange={(e) => set({ goalNotes: e.target.value })}
            />
            <div className="flex flex-wrap gap-2">
              {GOALS.map((g) => (
                <Chip key={g} selected={draft.goals.includes(g)} onClick={() => set({ goals: toggle(draft.goals, g) })}>
                  {GOAL_LABELS[g].label}
                </Chip>
              ))}
            </div>
          </div>
        </Row>
        <Row label="Workouts a week">
          <div className="flex items-center gap-3">
            <Step
              label="Fewer"
              disabled={draft.frequencyPerWeek <= 1}
              onClick={() => set({ frequencyPerWeek: draft.frequencyPerWeek - 1 })}
            >
              −
            </Step>
            <span className="w-8 text-center font-display text-2xl font-semibold tabular-nums">{draft.frequencyPerWeek}</span>
            <Step
              label="More"
              disabled={draft.frequencyPerWeek >= 7}
              onClick={() => set({ frequencyPerWeek: draft.frequencyPerWeek + 1 })}
            >
              +
            </Step>
          </div>
        </Row>
        <Row label="Minutes each">
          {DURATIONS.map((m) => (
            <Chip key={m} selected={draft.sessionMinutes === m} onClick={() => set({ sessionMinutes: m })}>
              {m}
            </Chip>
          ))}
          <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
            or
            <input
              type="number"
              inputMode="numeric"
              min={10}
              max={120}
              aria-label="Minutes per workout"
              className={cx(TEXT, "w-20 text-center", !DURATIONS.includes(draft.sessionMinutes) && "border-ink")}
              value={minutesText ?? draft.sessionMinutes}
              onChange={(e) => {
                setMinutesText(e.target.value);
                const n = Math.round(Number(e.target.value));
                if (n >= 10 && n <= 120) set({ sessionMinutes: n });
              }}
              onBlur={() => setMinutesText(null)}
            />
            min
          </label>
        </Row>
        <Row label="Days that work">
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
        </Row>
        <Row label="Times that work">
          {TIMES_OF_DAY.map((t) => (
            <Chip
              key={t}
              selected={draft.preferredTimes.includes(t)}
              onClick={() => set({ preferredTimes: toggle(draft.preferredTimes, t) })}
            >
              <span title={TIME_OF_DAY[t].range}>{TIME_OF_DAY[t].label}</span>
            </Chip>
          ))}
        </Row>
        <Row label="Equipment">
          {EQUIPMENT_PRESETS.map((p) => (
            <Chip key={p.id} selected={presetId === p.id} onClick={() => set({ equipment: p.items })}>
              {p.label}
            </Chip>
          ))}
          {!presetId && (
            <Chip selected onClick={() => undefined}>
              Custom ({draft.equipment.length})
            </Chip>
          )}
        </Row>
        <Row label="Can't work out" hint="Saves right away. Life Happens adds to this when you tell it.">
          <BlockedEditor
            state={state}
            onAdd={(b) => {
              // A whole day that's out stops being a day that works (one day always stays).
              if (b.date || !isAllDay(b)) return;
              const days = draft.preferredDays.filter((d) => !b.days.includes(d));
              if (days.length) set({ preferredDays: days });
            }}
          />
        </Row>
        <Row label="Notes for Pivot" hint="Lasting preferences in your words.">
          <NotesEditor state={state} />
        </Row>
        {learned.length > 0 && (
          <Row label="What Pivot noticed">
            <ul className="flex flex-col gap-1 text-sm text-ink-soft">
              {learned.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </Row>
        )}
      </Card>

      <More title="More options" hint="Workout style, exact equipment, things to avoid, and calendar. All optional.">
        <div className="flex flex-col gap-10">
          <section className="flex flex-col gap-4">
            <h3 className="text-xs font-semibold tracking-wider text-ink-faint uppercase">Workout style</h3>
            <StyleSection draft={draft} set={set} />
          </section>
          <section className="flex flex-col gap-4">
            <h3 className="text-xs font-semibold tracking-wider text-ink-faint uppercase">Equipment details</h3>
            <EquipmentSection draft={draft} set={set} />
            <ExtraEquipment draft={draft} set={set} />
          </section>
          <section className="flex flex-col gap-4">
            <h3 className="text-xs font-semibold tracking-wider text-ink-faint uppercase">Things to avoid</h3>
            <div className="flex flex-col gap-8">
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
              <BoundariesSection draft={draft} set={set} />
            </div>
          </section>
          <section className="flex flex-col gap-4">
            <h3 className="text-xs font-semibold tracking-wider text-ink-faint uppercase">Calendar</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {CALENDAR_PRESET_IDS.map((id) => (
                <OptionCard
                  key={id}
                  selected={calendar === id}
                  onClick={() => {
                    setCalendar(id);
                    setSaved(false);
                  }}
                  title={CALENDAR_PRESETS[id].label}
                  blurb={CALENDAR_PRESETS[id].blurb}
                />
              ))}
            </div>
          </section>
        </div>
      </More>
      <More title="Study tools" hint="Export or clear the user-testing log, or reset everything.">
        <StudyTools state={state} />
      </More>

      <div className="sticky bottom-4 z-10">
        <Card className="flex flex-col gap-3 p-4 shadow-lift sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={rebuild} onChange={(e) => setRebuild(e.target.checked)} className="accent-coral" />
            Update my plan with these changes
          </label>
          <div className="flex items-center gap-3">
            {error && <span className="text-sm font-medium text-coral-deep">{error}</span>}
            {saved && (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-sage-ink">
                <Check width={16} height={16} /> Saved
              </span>
            )}
            <Button onClick={save}>Save changes</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

const DURATIONS = [20, 30, 45, 60];
const TEXT = "w-full rounded-full border border-line-strong bg-card px-4 py-2 text-sm focus:border-ink focus:outline-none";

/** Equipment that isn't in Pivot's list. The AI planner sees it; the exercise library can't use it yet. */
function ExtraEquipment({ draft, set }: { draft: ProfileDraft; set: (patch: Partial<ProfileDraft>) => void }) {
  const [text, setText] = useState("");
  const items = draft.extraEquipment ?? [];
  const add = () => {
    const name = text.trim().slice(0, 40);
    if (!name || items.some((x) => x.toLowerCase() === name.toLowerCase()) || items.length >= 20) return;
    set({ extraEquipment: [...items, name] });
    setText("");
  };
  return (
    <Field label="Something not listed?" hint="Add it and the AI planner will know you have it.">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((x) => (
            <Removable key={x} onRemove={() => set({ extraEquipment: items.filter((y) => y !== x) })}>
              {x}
            </Removable>
          ))}
        </div>
      )}
      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className={TEXT}
          value={text}
          maxLength={40}
          placeholder="e.g. TRX straps, foam roller"
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" variant="dark" className="h-10" disabled={!text.trim()}>
          Add
        </Button>
      </form>
    </Field>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 px-5 py-4 sm:flex-row sm:items-start sm:gap-6 sm:px-6">
      <span className="flex shrink-0 flex-col gap-0.5 sm:w-36 sm:pt-2">
        <span className="text-sm font-semibold">{label}</span>
        {hint && <span className="text-xs text-ink-faint">{hint}</span>}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Step(props: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={`${props.label} workouts`}
      disabled={props.disabled}
      onClick={props.onClick}
      className="grid h-9 w-9 place-items-center rounded-full border border-line-strong bg-card text-lg transition hover:border-ink disabled:opacity-30"
    >
      {props.children}
    </button>
  );
}

/** A collapsed group for settings most people never need to touch. */
function More({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <details className="group rounded-[var(--radius-card)] border border-line bg-card/60">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 sm:px-6 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block font-semibold">{title}</span>
          <span className="block text-sm text-ink-soft">{hint}</span>
        </span>
        <span aria-hidden className="text-xl text-ink-faint transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="border-t border-line px-5 py-6 sm:px-6">{children}</div>
    </details>
  );
}

function StudyTools({ state }: { state: AppState }) {
  const [count, setCount] = useState(() => getEvents().length);
  return (
    <div>
      <p className="mb-5 text-sm text-ink-soft">
        For user testing. Pivot logs timing events in this browser only ({count} recorded). Nothing leaves your device unless you
        export it.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          onClick={() =>
            downloadJson(`pivot-study-log-${new Date().toISOString().slice(0, 19)}.json`, {
              exportedAt: new Date().toISOString(),
              events: getEvents(),
              history: state.history,
            })
          }
        >
          Export study log
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            clearEvents();
            setCount(0);
          }}
        >
          Clear log
        </Button>
        <Button
          variant="ghost"
          className="text-coral-deep"
          onClick={() => {
            if (window.confirm("Delete your profile, plan, and history from this browser?")) {
              pivot.reset();
              clearEvents();
            }
          }}
        >
          Reset all data
        </Button>
      </div>
    </div>
  );
}
