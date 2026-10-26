"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CALENDAR_PRESETS } from "@/lib/calendar";
import type { ChangeRecord, IsoDate, WeeklyPlan, WorkoutStatus } from "@/lib/schemas";
import { buildSamplePlan, calendarForWeek } from "@/lib/session";
import { pivot, useNow, usePivotState } from "@/lib/store";
import { track } from "@/lib/telemetry";
import { dayOfMonth, dayShort, formatTime, localNow, monthDay, mondayOf, toMinutes, weekDates } from "@/lib/time";
import { CONSTRAINT_LABELS, validatePlan, type ValidationResult } from "@/lib/validation";
import { CalendarIcon, Shield } from "../icons";
import { Button, ButtonLink, Card, Eyebrow, MockBadge, Skeleton, cx } from "../ui";
import { LifeHappens } from "./LifeHappens";
import { WorkoutCard } from "./WorkoutCard";
import { WorkoutDialog } from "./WorkoutDialog";

function greeting(time: string) {
  const h = Math.floor(toMinutes(time) / 60);
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function WeekView() {
  const state = usePivotState();
  const now = useNow();
  const [openId, setOpenId] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState(true);

  const weekStart = now ? mondayOf(now.date) : null;
  const calendar = useMemo(
    () => (state && weekStart ? calendarForWeek(state.calendarPreset, weekStart) : null),
    [state, weekStart],
  );
  const checks = useMemo(
    () =>
      state?.profile && state.plan && calendar
        ? validatePlan(state.plan, { profile: state.profile, busy: calendar.busy, knownRange: calendar.knownRange })
        : null,
    [state, calendar],
  );

  if (!state || !now || !weekStart || !calendar) return <WeekSkeleton />;

  if (!state.profile) {
    return (
      <EmptyState
        title="Let's build your first week."
        body="Answer a few questions about your goals and schedule, and Pivot will lay out a week that fits."
        action={<ButtonLink href="/onboarding">Get started</ButtonLink>}
      />
    );
  }

  const profile = state.profile;
  const plan = state.plan;

  const buildPlan = () => {
    const at = new Date();
    const next = buildSamplePlan({ profile, preset: state.calendarPreset, now: localNow(at), createdAt: at.toISOString() });
    pivot.setPlan(next);
    track("plan_generated", { source: "mock_template", workouts: next.workouts.length });
  };

  if (!plan || plan.weekStart !== weekStart) {
    return (
      <EmptyState
        title="A fresh week."
        body="Pivot will plan the rest of this week around your simulated calendar."
        action={<Button onClick={buildPlan}>Plan this week</Button>}
      />
    );
  }

  const openWorkout = plan.workouts.find((w) => w.id === openId) ?? null;
  const setStatus = (status: WorkoutStatus) => {
    if (!openWorkout) return;
    pivot.setWorkoutStatus(openWorkout.id, status);
    track("workout_status_changed", { status, category: openWorkout.category });
    setOpenId(null);
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-8 sm:px-8 sm:py-12">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="animate-rise">
          <Eyebrow>
            Week of {monthDay(weekStart)} – {monthDay(weekDates(weekStart)[6])}
          </Eyebrow>
          <h1 className="mt-2 font-display text-4xl font-medium tracking-tight sm:text-5xl">
            {greeting(now.time)}
            {profile.name ? `, ${profile.name}` : ""}.
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <MockBadge>Sample plan · template, not AI</MockBadge>
            <ChecksBadge result={checks} />
          </div>
        </div>
        <Progress plan={plan} />
      </header>

      <LifeHappens plan={plan} profile={profile} busy={calendar.busy} knownRange={calendar.knownRange} now={now} />

      {plan.notes.length > 0 && (
        <Card className="flex flex-col gap-1 border-butter/50 bg-butter-soft p-4 text-sm text-butter-ink shadow-none">
          {plan.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </Card>
      )}

      <section aria-label="This week" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-medium">Your week</h2>
          <button
            type="button"
            onClick={() => setShowCalendar((v) => !v)}
            aria-pressed={showCalendar}
            className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-card px-3.5 py-1.5 text-xs font-medium text-ink-soft hover:text-ink"
          >
            <CalendarIcon width={14} height={14} />
            {showCalendar ? "Hide" : "Show"} calendar · {CALENDAR_PRESETS[state.calendarPreset].label} (simulated)
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {weekDates(weekStart).map((date, i) => (
            <DayColumn
              key={date}
              date={date}
              index={i}
              isToday={date === now.date}
              isPast={date < now.date}
              plan={plan}
              busy={showCalendar ? calendar.busy.filter((b) => b.date === date) : []}
              onOpen={setOpenId}
            />
          ))}
        </div>
      </section>

      <History records={state.history} />

      <WorkoutDialog workout={openWorkout} onClose={() => setOpenId(null)} onStatus={setStatus} />
    </div>
  );
}

function DayColumn(props: {
  date: IsoDate;
  index: number;
  isToday: boolean;
  isPast: boolean;
  plan: WeeklyPlan;
  busy: { id: string; start: string; end: string; title: string }[];
  onOpen: (id: string) => void;
}) {
  const workouts = props.plan.workouts.filter((w) => w.date === props.date);
  const items: { start: string; el: ReactNode }[] = [
    ...props.busy.map((b) => ({
      start: b.start,
      el: (
        <div key={b.id} className="rounded-xl border border-line bg-paper-deep/60 px-3 py-2 text-[11px] text-ink-faint">
          <span className="font-semibold text-ink-soft">{formatTime(b.start)}</span> {b.title}
        </div>
      ),
    })),
    ...workouts.map((w) => ({
      start: w.start,
      el: <WorkoutCard key={w.id} workout={w} onOpen={() => props.onOpen(w.id)} />,
    })),
  ].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

  return (
    <div
      style={{ animationDelay: `${props.index * 40}ms` }}
      className={cx(
        "animate-rise flex flex-col gap-2 rounded-2xl p-2.5 lg:min-h-64",
        props.isToday ? "bg-card ring-2 ring-coral/60" : "bg-paper-deep/50",
        props.isPast && "opacity-70",
      )}
    >
      <div className="flex items-baseline justify-between px-1.5 pt-1 pb-1">
        <span className={cx("text-xs font-semibold uppercase tracking-wider", props.isToday ? "text-coral-deep" : "text-ink-faint")}>
          {props.isToday ? "Today" : dayShort(props.date)}
        </span>
        <span className="font-display text-xl font-medium">{dayOfMonth(props.date)}</span>
      </div>
      {items.map((it) => it.el)}
      {workouts.length === 0 && <p className="px-1.5 pb-2 text-xs text-ink-faint italic">Rest day</p>}
    </div>
  );
}

function Progress({ plan }: { plan: WeeklyPlan }) {
  const counted = plan.workouts.filter((w) => w.status !== "skipped");
  const done = plan.workouts.filter((w) => w.status === "completed");
  const minutesDone = done.reduce((s, w) => s + w.durationMin, 0);
  const minutesPlanned = counted.reduce((s, w) => s + w.durationMin, 0);
  const pct = counted.length ? done.length / counted.length : 0;
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <Card className="flex items-center gap-5 px-5 py-4">
      <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90" aria-hidden>
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-paper-deep)" strokeWidth="7" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="var(--color-coral)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-0.5">
        <dt className="text-xs text-ink-faint">Workouts</dt>
        <dt className="text-xs text-ink-faint">Minutes</dt>
        <dd className="font-display text-2xl font-semibold tabular-nums">
          {done.length}
          <span className="text-base text-ink-faint">/{counted.length}</span>
        </dd>
        <dd className="font-display text-2xl font-semibold tabular-nums">
          {minutesDone}
          <span className="text-base text-ink-faint">/{minutesPlanned}</span>
        </dd>
      </dl>
    </Card>
  );
}

function ChecksBadge({ result }: { result: ValidationResult | null }) {
  const [open, setOpen] = useState(false);
  if (!result) return null;
  const failing = new Set(result.violations.map((v) => v.constraint));
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cx(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider",
          result.ok ? "bg-sage-soft text-sage-ink" : "bg-coral-soft text-coral-ink",
        )}
      >
        <Shield width={13} height={13} />
        {result.ok ? `${result.checked.length} checks passed` : `${result.violations.length} issue${result.violations.length > 1 ? "s" : ""}`}
      </button>
      {open && (
        <Card className="absolute top-9 left-0 z-20 w-80 animate-rise p-4 text-sm">
          <p className="mb-2 font-semibold">Deterministic schedule checks</p>
          <ul className="flex flex-col gap-1.5">
            {result.checked.map((c) => (
              <li key={c} className="flex items-center gap-2">
                <span className={cx("h-2 w-2 rounded-full", failing.has(c) ? "bg-coral" : "bg-sage")} />
                {CONSTRAINT_LABELS[c]}
              </li>
            ))}
          </ul>
          {result.violations.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-xs text-coral-ink">
              {result.violations.map((v, i) => (
                <li key={i}>{v.message}</li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

function History({ records }: { records: ChangeRecord[] }) {
  if (!records.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-2xl font-medium">Recent changes</h2>
      <Card className="divide-y divide-line">
        {records.slice(0, 5).map((r) => (
          <div key={r.id} className="flex flex-col gap-0.5 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div>
              <p className="text-sm font-medium">&ldquo;{r.userMessage}&rdquo;</p>
              <p className="text-sm text-ink-soft">{r.summary}</p>
            </div>
            <span
              className={cx(
                "shrink-0 self-start rounded-full px-2.5 py-0.5 text-[11px] font-semibold sm:self-center",
                r.decision === "accepted" ? "bg-sage-soft text-sage-ink" : "bg-ink/10 text-ink-soft",
              )}
            >
              {r.decision === "accepted" ? "Accepted" : "Declined"}
            </span>
          </div>
        ))}
      </Card>
    </section>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 px-5 py-24 text-center">
      <h1 className="font-display text-4xl font-medium tracking-tight">{title}</h1>
      <p className="text-ink-soft">{body}</p>
      {action}
    </div>
  );
}

function WeekSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 sm:px-8" aria-busy="true">
      <Skeleton className="h-16 w-80" />
      <Skeleton className="h-48 w-full" />
      <div className="grid gap-3 lg:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    </div>
  );
}
