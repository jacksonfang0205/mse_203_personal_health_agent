"use client";

import { useMemo, useState, type ReactNode } from "react";
import { agentSnapshot, requestPlan, useAiStatus, type AiStatus } from "@/lib/agentClient";
import { CALENDAR_PRESETS } from "@/lib/calendar";
import { dayCapacity, formatFree } from "@/lib/capacity";
import type { BusyBlock, ChangeRecord, IsoDate, WeeklyPlan, WorkoutStatus } from "@/lib/schemas";
import { buildSamplePlan, calendarForWeek } from "@/lib/session";
import { pivot, useNow, usePivotState } from "@/lib/store";
import { track } from "@/lib/telemetry";
import { dayOfMonth, dayShort, formatTime, localNow, monthDay, mondayOf, toMinutes, weekDates } from "@/lib/time";
import { CONSTRAINT_LABELS, validatePlan, type ValidationResult } from "@/lib/validation";
import { CalendarIcon, Shield, Sparkle } from "../icons";
import { Button, ButtonLink, Card, Eyebrow, MockBadge, Skeleton, cx } from "../ui";
import { LifeHappens } from "./LifeHappens";
import { Today, streakOf } from "./Today";
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
  const [showCalendar, setShowCalendar] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [planNote, setPlanNote] = useState<string | null>(null);
  const ai = useAiStatus();

  const weekStart = now ? mondayOf(now.date) : null;
  const calendar = useMemo(
    () => (state && weekStart ? calendarForWeek(state.calendarPreset, weekStart, state.blocked) : null),
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

  const buildPlan = async () => {
    const at = new Date();
    setPlanNote(null);
    if (ai?.ai) {
      setPlanning(true);
      try {
        const res = await requestPlan(agentSnapshot(pivot.get(), localNow(at)));
        pivot.setPlan(res.plan);
        setPlanNote(res.fallback ?? null);
        track("plan_generated", { source: res.plan.generatedBy, workouts: res.plan.workouts.length });
        return;
      } catch (e) {
        setPlanNote(`AI planning failed (${(e as Error).message}). Showing a template plan instead.`);
      } finally {
        setPlanning(false);
      }
    }
    // Template planner, still aware of blocked times.
    const now = localNow(at);
    const keep = state.plan?.weekStart === weekStart ? state.plan.workouts.filter((w) => w.status === "completed") : [];
    const next = buildSamplePlan({
      profile,
      preset: state.calendarPreset,
      now,
      createdAt: at.toISOString(),
      keep,
      blocked: state.blocked,
    });
    pivot.setPlan(next);
    track("plan_generated", { source: "mock_template", workouts: next.workouts.length });
  };

  if (!plan || plan.weekStart !== weekStart) {
    return (
      <EmptyState
        title="A fresh week."
        body="Pivot picks which days get a workout, based on how much free time each day has. You do each one whenever suits you."
        action={
          <div className="flex flex-col items-center gap-3">
            <Button onClick={buildPlan} disabled={planning || !ai}>
              {planning ? "Planning…" : ai?.ai ? "Plan this week with AI" : "Plan this week"}
            </Button>
            {planNote && <p className="text-sm text-coral-deep">{planNote}</p>}
          </div>
        }
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
            <PlanBadge plan={plan} ai={ai} />
            <ChecksBadge result={checks} />
            <Button variant="secondary" className="h-8 px-3.5 text-xs" onClick={buildPlan} disabled={planning || !ai}>
              <Sparkle width={14} height={14} />
              {planning ? "Planning…" : ai?.ai ? "Replan with AI" : "Rebuild plan"}
            </Button>
          </div>
        </div>
        <Progress plan={plan} />
      </header>

      {planNote && (
        <Card className="border-coral/30 bg-coral-soft p-4 text-sm text-coral-ink shadow-none">{planNote}</Card>
      )}

      <Today
        plan={plan}
        today={now.date}
        steps={state.steps}
        freeToday={dayCapacity(now.date, calendar.busy, now.time)}
        streak={streakOf(plan, state.log, now.date)}
        onOpen={setOpenId}
      />

      <LifeHappens
        plan={plan}
        profile={profile}
        busy={calendar.busy}
        knownRange={calendar.knownRange}
        now={now}
        ai={ai?.ai ?? false}
      />

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
            {showCalendar ? "Hide" : "Show"} events · {CALENDAR_PRESETS[state.calendarPreset].label} (simulated)
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
              busy={calendar.busy.filter((b) => b.date === date)}
              showEvents={showCalendar}
              free={date < now.date ? 0 : dayCapacity(date, calendar.busy, date === now.date ? now.time : undefined)}
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
  busy: BusyBlock[];
  showEvents: boolean;
  /** Longest free stretch, in minutes. */
  free: number;
  onOpen: (id: string) => void;
}) {
  const workouts = props.plan.workouts.filter((w) => w.date === props.date);
  // 16 waking hours; the bar shows how open the day is at a glance.
  const openness = Math.min(1, props.free / (16 * 60));
  return (
    <div
      style={{ animationDelay: `${props.index * 40}ms` }}
      className={cx(
        "animate-rise flex flex-col gap-2 rounded-2xl p-2.5 lg:min-h-56",
        props.isToday ? "bg-card ring-2 ring-coral/60" : "bg-paper-deep/50",
        props.isPast && "opacity-70",
      )}
    >
      <div className="flex items-baseline justify-between px-1.5 pt-1">
        <span className={cx("text-xs font-semibold uppercase tracking-wider", props.isToday ? "text-coral-deep" : "text-ink-faint")}>
          {props.isToday ? "Today" : dayShort(props.date)}
        </span>
        <span className="font-display text-xl font-medium">{dayOfMonth(props.date)}</span>
      </div>
      {!props.isPast && (
        <div className="px-1.5" title={`Longest free stretch: ${props.free} min`}>
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-sage/70" style={{ width: `${openness * 100}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-ink-faint">{formatFree(props.free)}</p>
        </div>
      )}
      {workouts.map((w) => (
        <WorkoutCard key={w.id} workout={w} onOpen={() => props.onOpen(w.id)} />
      ))}
      {workouts.length === 0 && <p className="px-1.5 text-xs text-ink-faint italic">Rest day</p>}
      {props.showEvents &&
        props.busy.map((b) => (
          <div
            key={b.id}
            title={b.source === "blocked" ? "You told Pivot you can't work out now" : undefined}
            className={cx(
              "rounded-xl border px-2.5 py-1.5 text-[11px]",
              b.source === "blocked"
                ? "border-dashed border-coral/40 bg-coral-soft/40 text-coral-ink"
                : "border-line bg-paper-deep/60 text-ink-faint",
            )}
          >
            {b.source === "blocked" ? "⊘ " : ""}
            {b.start === "00:00" && b.end >= "23:00" ? "All day" : formatTime(b.start)} {b.title}
          </div>
        ))}
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

function PlanBadge({ plan, ai }: { plan: WeeklyPlan; ai: AiStatus | null }) {
  if (plan.generatedBy === "agent") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-lilac-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-lilac-ink">
        <Sparkle width={13} height={13} /> Planned by AI{ai?.model ? ` · ${ai.model}` : ""}
      </span>
    );
  }
  return <MockBadge>Sample plan · template, not AI</MockBadge>;
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
