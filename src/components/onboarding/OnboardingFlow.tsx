"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  AVOID_TAG_LABELS,
  EQUIPMENT_LABELS,
  EXPERIENCE_LABELS,
  GOAL_LABELS,
  MUSCLE_LABELS,
  TIME_OF_DAY,
  WEEKDAY_LABELS,
  WORKOUT_TYPE_LABELS,
} from "@/lib/labels";
import { buildSamplePlan } from "@/lib/session";
import { pivot } from "@/lib/store";
import { track } from "@/lib/telemetry";
import { localNow } from "@/lib/time";
import { ArrowLeft, ArrowRight, PivotMark } from "../icons";
import {
  BoundariesSection,
  DEFAULT_DRAFT,
  EquipmentSection,
  GoalsSection,
  SECTION_CHECKS,
  ScheduleSection,
  StyleSection,
  finalizeDraft,
  type ProfileDraft,
  type SectionProps,
} from "../preferences/sections";
import { Button, cx } from "../ui";

const STEPS = [
  { key: "goals", title: "Let's start with why.", sub: "Your goals shape every plan Pivot makes.", Section: GoalsSection },
  { key: "style", title: "How do you like to move?", sub: "Pivot plans around what you'll actually show up for.", Section: StyleSection },
  { key: "equipment", title: "What's in your toolkit?", sub: "Pivot only suggests exercises you can do with what you have.", Section: EquipmentSection },
  { key: "schedule", title: "When does fitness fit?", sub: "Pivot reads your calendar and fills the gaps around it.", Section: ScheduleSection },
  { key: "boundaries", title: "Set your boundaries.", sub: "Anything here is off the table, every time.", Section: BoundariesSection },
  { key: "review", title: "Here's what Pivot heard.", sub: "Check it over. You can change any of this later.", Section: ReviewSection },
] as const;

export function OnboardingFlow() {
  const router = useRouter();
  const [draft, setDraft] = useState<ProfileDraft>(DEFAULT_DRAFT);
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    startedAt.current = Date.now();
    track("onboarding_started");
  }, []);

  const step = STEPS[stepIdx];
  const set = (patch: Partial<ProfileDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  };

  const check = step.key === "review" ? null : SECTION_CHECKS[step.key](draft);

  const next = () => {
    if (check) {
      setError(check);
      return;
    }
    track("onboarding_step_completed", { step: step.key, msSinceStart: Date.now() - startedAt.current });
    if (step.key !== "review") {
      setStepIdx((i) => i + 1);
      window.scrollTo({ top: 0 });
      return;
    }
    const now = new Date();
    const parsed = finalizeDraft(draft, now.toISOString());
    if (!parsed.success) {
      setError("Something's missing. Go back and check each step.");
      return;
    }
    const preset = pivot.get().calendarPreset;
    const plan = buildSamplePlan({ profile: parsed.data, preset, now: localNow(now), createdAt: now.toISOString() });
    pivot.saveProfile(parsed.data);
    pivot.setPlan(plan);
    track("onboarding_completed", { durationMs: Date.now() - startedAt.current });
    track("plan_generated", { source: "mock_template", workouts: plan.workouts.length });
    router.push("/week");
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(320px,0.8fr)_1.6fr]">
      <aside className="relative hidden overflow-hidden bg-ink p-10 text-paper lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="flex items-center gap-2">
          <PivotMark width={26} height={26} className="text-coral" />
          <span className="font-display text-2xl font-semibold italic">Pivot</span>
        </Link>
        <div key={step.key} className="animate-rise">
          <p className="mb-4 text-sm font-semibold text-coral">
            Step {stepIdx + 1} of {STEPS.length}
          </p>
          <h1 className="font-display text-5xl leading-[1.05] font-medium tracking-tight">{step.title}</h1>
          <p className="mt-4 max-w-sm text-paper/70">{step.sub}</p>
        </div>
        <ol className="flex flex-col gap-2 text-sm">
          {STEPS.map((s, i) => (
            <li key={s.key} className={cx("flex items-center gap-3", i === stepIdx ? "text-paper" : "text-paper/40")}>
              <span className={cx("h-1.5 rounded-full transition-all", i <= stepIdx ? "w-6 bg-coral" : "w-3 bg-paper/30")} />
              {s.title}
            </li>
          ))}
        </ol>
        <div aria-hidden className="pointer-events-none absolute -right-24 -bottom-24 h-72 w-72 rounded-full bg-coral/20 blur-3xl" />
      </aside>

      <section className="flex flex-col">
        <div className="sticky top-0 z-10 border-b border-line/70 bg-paper/90 px-5 py-4 backdrop-blur sm:px-10">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-ink-soft lg:hidden">
              Step {stepIdx + 1} of {STEPS.length}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-deep lg:max-w-md">
              <div
                className="h-full rounded-full bg-coral transition-all duration-500"
                style={{ width: `${((stepIdx + 1) / STEPS.length) * 100}%` }}
              />
            </div>
            <Link href="/" className="text-sm text-ink-soft hover:text-ink">
              Exit
            </Link>
          </div>
        </div>

        <div key={step.key} className="mx-auto w-full max-w-3xl flex-1 animate-rise px-5 py-10 sm:px-10">
          <div className="mb-8 lg:hidden">
            <h1 className="font-display text-4xl leading-tight font-medium tracking-tight">{step.title}</h1>
            <p className="mt-2 text-ink-soft">{step.sub}</p>
          </div>
          <step.Section draft={draft} set={set} jump={setStepIdx} />
        </div>

        <div className="sticky bottom-0 border-t border-line/70 bg-paper/95 px-5 py-4 backdrop-blur sm:px-10">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
            <Button variant="ghost" onClick={() => setStepIdx((i) => i - 1)} disabled={stepIdx === 0}>
              <ArrowLeft /> Back
            </Button>
            {error && (
              <p role="alert" className="text-sm font-medium text-coral-deep">
                {error}
              </p>
            )}
            <Button onClick={next}>
              {step.key === "review" ? "Build my week" : "Continue"} <ArrowRight />
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ReviewSection({ draft, set, jump }: SectionProps) {
  const list = (items: string[], empty = "None") => (items.length ? items.join(", ") : empty);
  const rows: { label: string; value: string; step: number }[] = [
    { label: "Goals", value: list(draft.goals.map((g) => GOAL_LABELS[g].label)), step: 0 },
    { label: "Focus areas", value: list(draft.targetMuscles.map((m) => MUSCLE_LABELS[m]), "Balanced"), step: 0 },
    { label: "Experience", value: EXPERIENCE_LABELS[draft.experience].label, step: 1 },
    { label: "Workouts you enjoy", value: list(draft.workoutTypes.map((t) => WORKOUT_TYPE_LABELS[t])), step: 1 },
    { label: "Equipment", value: list(draft.equipment.map((e) => EQUIPMENT_LABELS[e]), "Bodyweight only"), step: 2 },
    { label: "Sessions", value: `${draft.frequencyPerWeek}× a week, up to ${draft.sessionMinutes} min`, step: 3 },
    { label: "Days", value: list(draft.preferredDays.map((d) => WEEKDAY_LABELS[d].short)), step: 3 },
    { label: "Times", value: list(draft.preferredTimes.map((t) => TIME_OF_DAY[t].label)), step: 3 },
    { label: "Avoiding", value: list(draft.avoidTags.map((t) => AVOID_TAG_LABELS[t].label)), step: 4 },
  ];
  return (
    <div className="flex flex-col gap-8">
      <label className="flex flex-col gap-2">
        <span className="text-[15px] font-semibold">What should Pivot call you?</span>
        <input
          className="w-full max-w-sm rounded-2xl border border-line-strong bg-card px-4 py-3 text-sm focus:border-ink focus:outline-none"
          placeholder="First name (optional)"
          maxLength={60}
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <dl className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-card">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-4 px-5 py-4">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{r.label}</dt>
              <dd className="mt-1 text-sm text-ink">{r.value}</dd>
            </div>
            <button type="button" onClick={() => jump?.(r.step)} className="text-sm font-medium text-coral-deep hover:underline">
              Edit
            </button>
          </div>
        ))}
      </dl>
      <p className="text-sm text-ink-soft">
        Next, Pivot builds a <strong>sample week</strong> around a simulated calendar. Live AI planning arrives in the next
        milestone.
      </p>
    </div>
  );
}
