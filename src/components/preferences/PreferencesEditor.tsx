"use client";

import { useState, type ReactNode } from "react";
import { CALENDAR_PRESETS, CALENDAR_PRESET_IDS, type CalendarPresetId } from "@/lib/calendar";
import type { FitnessProfile } from "@/lib/schemas";
import { buildSamplePlan } from "@/lib/session";
import { pivot, usePivotState, type AppState } from "@/lib/store";
import { clearEvents, downloadJson, getEvents, track } from "@/lib/telemetry";
import { localNow } from "@/lib/time";
import { Check } from "../icons";
import { Button, ButtonLink, Card, Eyebrow, OptionCard, Skeleton } from "../ui";
import { MemorySection } from "./MemorySection";
import {
  BoundariesSection,
  EquipmentSection,
  GoalsSection,
  SECTION_CHECKS,
  ScheduleSection,
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
  const [preset, setPreset] = useState<CalendarPresetId>(state.calendarPreset);
  const [rebuild, setRebuild] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
    pivot.setCalendarPreset(preset);
    if (rebuild) {
      const keep = state.plan?.workouts.filter((w) => w.status === "completed") ?? [];
      pivot.setPlan(
        buildSamplePlan({ profile: parsed.data, preset, now: localNow(at), createdAt: at.toISOString(), keep, blocked: state.blocked }),
      );
    }
    pivot.saveProfile(parsed.data);
    track("preferences_saved", { rebuilt: rebuild });
    setSaved(true);
  };

  const sections: { title: string; body: ReactNode }[] = [
    { title: "Goals", body: <GoalsSection draft={draft} set={set} /> },
    { title: "Style", body: <StyleSection draft={draft} set={set} /> },
    { title: "Equipment", body: <EquipmentSection draft={draft} set={set} /> },
    { title: "Schedule", body: <ScheduleSection draft={draft} set={set} /> },
    { title: "Boundaries", body: <BoundariesSection draft={draft} set={set} /> },
  ];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8">
      <header>
        <Eyebrow>Preferences</Eyebrow>
        <h1 className="mt-2 font-display text-4xl font-medium tracking-tight sm:text-5xl">What Pivot knows about you</h1>
        <p className="mt-3 text-ink-soft">Change anything here. Pivot uses it the next time it plans.</p>
      </header>

      <label className="flex max-w-sm flex-col gap-2">
        <span className="text-[15px] font-semibold">Name</span>
        <input
          className="rounded-2xl border border-line-strong bg-card px-4 py-3 text-sm focus:border-ink focus:outline-none"
          value={draft.name}
          maxLength={60}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>

      {sections.map((s) => (
        <Card key={s.title} className="p-6 sm:p-8">
          <h2 className="mb-6 font-display text-2xl font-medium">{s.title}</h2>
          {s.body}
        </Card>
      ))}

      <Card className="p-6 sm:p-8">
        <h2 className="font-display text-2xl font-medium">Calendar</h2>
        <p className="mt-1 mb-6 text-sm text-ink-soft">
          Pivot uses a <strong>simulated calendar</strong> for now. Google Calendar (read-only) comes in a later milestone.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {CALENDAR_PRESET_IDS.map((id) => (
            <OptionCard
              key={id}
              selected={preset === id}
              onClick={() => {
                setPreset(id);
                setSaved(false);
              }}
              title={CALENDAR_PRESETS[id].label}
              blurb={CALENDAR_PRESETS[id].blurb}
            />
          ))}
        </div>
      </Card>

      <MemorySection state={state} />

      <StudyTools state={state} />

      <div className="sticky bottom-4 z-10">
        <Card className="flex flex-col gap-3 p-4 shadow-lift sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={rebuild} onChange={(e) => setRebuild(e.target.checked)} className="accent-coral" />
            Rebuild this week&apos;s plan from a template (completed workouts are kept; use Replan with AI on the week view for AI)
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

function StudyTools({ state }: { state: AppState }) {
  const [count, setCount] = useState(() => getEvents().length);
  return (
    <Card className="border-dashed p-6 sm:p-8">
      <h2 className="font-display text-2xl font-medium">Study tools</h2>
      <p className="mt-1 mb-5 text-sm text-ink-soft">
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
    </Card>
  );
}
