"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { acceptBendingMove, fixClashes } from "@/lib/account";
import type { BendingMove } from "@/lib/planner/clashes";
import { agentSnapshot, requestPlan, useAiStatus } from "@/lib/agentClient";
import { findClashes } from "@/lib/planner/clashes";
import { computeInsights, learnedTimeOrder } from "@/lib/insights";
import { getExercise } from "@/lib/catalog";
import type { BusyBlock, ExerciseLog, IsoDate, WeeklyPlan, WeightUnit, Workout, WorkoutStatus } from "@/lib/schemas";
import { planFromRoutine } from "@/lib/routine";
import { buildSamplePlan, calendarForWeek, carryOver } from "@/lib/session";
import { pivot, setCount, useNow, usePivotState } from "@/lib/store";
import { track } from "@/lib/telemetry";
import { addDays, dayOfMonth, dayShort, formatDate, formatTime, localNow, monthDay, planCovers, toMinutes, weekDates } from "@/lib/time";
import { firstUp, revealReasons } from "@/lib/planReveal";
import { CONSTRAINT_LABELS, validatePlan, type ValidationResult } from "@/lib/validation";
import { CalendarIcon, Check, Shield, Sparkle } from "../icons";
import { Button, ButtonLink, Card, Eyebrow, Skeleton, cx } from "../ui";
import { LifeHappens } from "./LifeHappens";
import { ExerciseVisual } from "./ExerciseVisual";
import { MovementCard, prescription, setsDone } from "./MovementCard";
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
  // Open the workout straight into "Change movements".
  const [editOnOpen, setEditOnOpen] = useState(false);
  const [showCalendar, setShowCalendar] = useState(true);
  // Right after onboarding (/week?welcome=1) the whole week is revealed with the reasoning behind it.
  const params = useSearchParams();
  const [welcome, setWelcome] = useState(() => params.has("welcome"));
  const [planning, setPlanning] = useState(false);
  const [planNote, setPlanNote] = useState<string | null>(null);
  const [pendingMoves, setPendingMoves] = useState<BendingMove[]>([]);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const ai = useAiStatus();

  const today = now?.date ?? null;
  // The plan's own 7-day window (it starts on the day it was made); a fresh plan starts today.
  const weekStart = today ? (state?.plan && planCovers(state.plan, today) ? state.plan.weekStart : today) : null;
  const calendar = useMemo(
    () => (state && weekStart ? calendarForWeek(state.calendarPreset, weekStart, state.blocked) : null),
    [state, weekStart],
  );
  // What the week view shows: today and the six days after it.
  const shown = useMemo(
    () => (state && today ? calendarForWeek(state.calendarPreset, today, state.blocked) : null),
    [state, today],
  );
  const checks = useMemo(
    () =>
      state?.profile && state.plan && calendar
        ? // "Fits your schedule" means the validator checked days, time windows and length too, not just conflicts.
          validatePlan(state.plan, { profile: state.profile, busy: calendar.busy, knownRange: calendar.knownRange, lockPreferences: true })
        : null,
    [state, calendar],
  );

  if (!state || !now || !today || !weekStart || !calendar || !shown) return <WeekSkeleton />;

  if (!state.profile) {
    return (
      <EmptyState
        title="Let's build your first week."
        body="A few quick questions, then your week."
        action={<ButtonLink href="/onboarding">Get started</ButtonLink>}
      />
    );
  }

  const profile = state.profile;
  const plan = state.plan;

  const buildPlan = async () => {
    const at = new Date();
    setPlanNote(null);
    // Users with their own routine get the week straight from it.
    if (state.routine) {
      const now = localNow(at);
      const next = planFromRoutine({
        routine: state.routine,
        weekStart: now.date,
        createdAt: at.toISOString(),
        keep: carryOver(state.plan, now.date),
      });
      pivot.setPlan(next);
      track("plan_generated", { source: "routine", workouts: next.workouts.length });
      return;
    }
    if (ai?.ai) {
      setPlanning(true);
      try {
        const res = await requestPlan(agentSnapshot(pivot.get(), localNow(at)));
        pivot.setPlan(res.plan);
        setPlanNote(res.fallback ?? null);
        track("plan_generated", { source: res.plan.generatedBy, workouts: res.plan.workouts.length });
        return;
      } catch (e) {
        setPlanNote(`The AI ${(e as Error).message === "took too long" ? "took too long" : "couldn't answer"}, so this is a quick plan. You can ask your coach to adjust it.`);
      } finally {
        setPlanning(false);
      }
    }
    // Template planner, still aware of blocked times and past completion.
    const now = localNow(at);
    const insights = computeInsights({ log: state.log, history: state.history, plan: state.plan, now });
    const keep = carryOver(state.plan, now.date);
    const next = buildSamplePlan({
      profile,
      preset: state.calendarPreset,
      now,
      createdAt: at.toISOString(),
      keep,
      blocked: state.blocked,
      timeOrder: learnedTimeOrder(profile.preferredTimes, insights),
      strictPreferences: true,
    });
    pivot.setPlan(next);
    track("plan_generated", { source: "mock_template", workouts: next.workouts.length });
  };

  if (!plan || !planCovers(plan, today)) {
    return (
      <EmptyState
        title="A fresh week."
        body={state.routine ? "Lay out the next seven days from your routine." : "Plan the next seven days around your calendar."}
        action={
          <div className="flex flex-col items-center gap-3">
            <Button onClick={buildPlan} disabled={planning || (!ai && !state.routine)}>
              {planning ? "Planning…" : state.routine ? "Start my week" : "Plan my week"}
            </Button>
            {planning && <p className="text-sm text-ink-soft">This can take up to 30 seconds.</p>}
            {planNote && <p className="text-sm text-coral-deep">{planNote}</p>}
          </div>
        }
      />
    );
  }

  const clashes = findClashes(plan, calendar.busy, now);
  const openWorkout = plan.workouts.find((w) => w.id === openId) ?? null;
  const setStatus = (status: WorkoutStatus) => {
    if (!openWorkout) return;
    const refused = pivot.setWorkoutStatus(openWorkout.id, status);
    if (refused) {
      setStatusNote(refused);
      return;
    }
    track("workout_status_changed", { status, category: openWorkout.category });
    setOpenId(null);
  };
  const open = (id: string, edit = false) => {
    setEditOnOpen(edit);
    setOpenId(id);
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-8 sm:px-8 sm:py-12">
      <header className="relative z-30 flex flex-col gap-5 rounded-[1.75rem] bg-sky p-6 text-ink sm:p-8 lg:flex-row lg:items-end lg:justify-between">
        {/* Decorative circles from the style tile; clipped here so the checks popover below isn't. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[1.75rem]">
          <div className="absolute -top-24 -right-16 h-72 w-72 rounded-full bg-white/20" />
          <div className="absolute -bottom-28 right-48 h-56 w-56 rounded-full bg-mint/40" />
        </div>
        <div className="relative animate-rise">
          <Eyebrow className="text-ink/75">
            {monthDay(today)} – {monthDay(addDays(today, 6))}
          </Eyebrow>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            {welcome ? "Here's your week" : greeting(now.time)}
            {profile.name ? `, ${profile.name}` : ""}.
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ChecksBadge result={checks} />
            <Link
              href="/routine"
              className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-card px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft hover:border-ink/40 hover:text-ink"
            >
              {state.routine ? "Your routine · edit" : "Use my own routine"}
            </Link>
          </div>
        </div>
        <div className="relative">
          <Progress plan={plan} />
        </div>
      </header>

      {welcome && (
        <PlanReveal
          reasons={revealReasons(profile, plan, calendar.busy)}
          first={firstUp(plan, today)}
          onDone={() => {
            setWelcome(false);
            window.history.replaceState(null, "", "/week");
            track("plan_reveal_dismissed");
          }}
        />
      )}

      {planNote && <Card className="border-coral/30 bg-coral-soft p-4 text-sm text-coral-ink shadow-none">{planNote}</Card>}

      {clashes.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-coral/30 bg-coral-soft p-4 text-sm text-coral-ink shadow-none">
          <span>
            {clashes.map((w) => `${w.title} (${dayShort(w.date)} ${formatTime(w.start)})`).join(", ")}{" "}
            {clashes.length > 1 ? "clash" : "clashes"} with your calendar.
          </span>
          <Button
            variant="dark"
            className="h-9 px-4"
            onClick={() => {
              const r = fixClashes();
              setPendingMoves(r.needsOk);
              const moved = r.moved.length
                ? `Moved ${r.moved.map((m) => `${m.title} to ${formatDate(m.to.date)} ${formatTime(m.to.start)}`).join(", ")}.`
                : "";
              const stuck = r.unresolved.length
                ? ` ${r.unresolved.length} still clash${r.unresolved.length > 1 ? "" : "es"} with no free time left this week.`
                : "";
              setPlanNote(`${moved}${stuck}`.trim() || null);
            }}
          >
            Move {clashes.length > 1 ? "them" : "it"}
          </Button>
        </Card>
      )}

      {pendingMoves.length > 0 && (
        <Card className="flex flex-col gap-2 border-butter/50 bg-butter-soft p-4 text-sm text-butter-ink shadow-none">
          {pendingMoves.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-3">
              <span>
                <span className="font-semibold">{m.title}</span>: {m.ask} ({formatDate(m.to.date)}, {formatTime(m.to.start)})
              </span>
              <span className="flex gap-2">
                <Button
                  variant="dark"
                  className="h-8 px-3.5 text-xs"
                  onClick={() => {
                    acceptBendingMove(m);
                    setPendingMoves((p) => p.filter((x) => x.id !== m.id));
                  }}
                >
                  OK
                </Button>
                <Button variant="secondary" className="h-8 px-3.5 text-xs" onClick={() => setPendingMoves((p) => p.filter((x) => x.id !== m.id))}>
                  No, leave it
                </Button>
              </span>
            </div>
          ))}
        </Card>
      )}

        <section aria-label="This week" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-semibold uppercase tracking-wide">Your next 7 days</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowCalendar((v) => !v)}
                aria-pressed={showCalendar}
                className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-card px-3.5 py-1.5 text-xs font-medium text-ink-soft hover:text-ink"
              >
                <CalendarIcon width={14} height={14} />
                {showCalendar ? "Hide" : "Show"} calendar
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            {weekDates(today).map((date, i) => (
              <DayColumn
                key={date}
                date={date}
                index={i}
                isToday={date === now.date}
                planned={planCovers(plan, date)}
                plan={plan}
                busy={showCalendar ? shown.busy.filter((b) => b.date === date) : []}
                ticks={state.ticks}
                lifts={state.lifts}
                weightUnit={state.weightUnit}
                onOpen={(id) => open(id)}
                onEdit={(id) => open(id, true)}
                showWhy={welcome}
              />
            ))}
          </div>
        </section>

      {plan.notes.length > 0 && (
        <Card className="flex flex-col gap-1 border-butter/50 bg-butter-soft p-4 text-sm text-butter-ink shadow-none">
          {plan.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </Card>
      )}

      <LifeHappens
        plan={plan}
        profile={profile}
        busy={calendar.busy}
        knownRange={calendar.knownRange}
        now={now}
        ai={ai?.ai ?? false}
      />

      <WorkoutDialog
        workout={openWorkout}
        today={today}
        note={statusNote}
        lifts={state.lifts}
        weightUnit={state.weightUnit}
        profile={profile}
        startEditing={editOnOpen}
        onClose={() => {
          setOpenId(null);
          setStatusNote(null);
        }}
        onStatus={setStatus}
        onSaveExercises={(exercises, from) => {
          if (!openWorkout) return;
          pivot.setWorkoutExercises(openWorkout.id, exercises, from);
          track("workout_movements_changed", { movements: exercises.length, category: openWorkout.category });
        }}
      />
    </div>
  );
}

function DayColumn(props: {
  date: IsoDate;
  index: number;
  isToday: boolean;
  /** False for days after the plan's window ends. */
  planned: boolean;
  plan: WeeklyPlan;
  busy: BusyBlock[];
  ticks: Record<string, number[]>;
  /** Logged sets, reps and weight; drives each movement's target. */
  lifts: ExerciseLog[];
  weightUnit: WeightUnit;
  onOpen: (id: string) => void;
  /** Open a workout straight into "Change movements". */
  onEdit: (id: string) => void;
  /** Show each workout's reasoning under its card (the first look after onboarding). */
  showWhy?: boolean;
}) {
  const workouts = props.plan.workouts
    .filter((w) => w.date === props.date)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const busy = [...props.busy].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

  // One row per day, stacked top to bottom: date on the left, the day's workouts and calendar on the right.
  return (
    <div
      style={{ animationDelay: `${props.index * 40}ms` }}
      className={cx(
        "animate-rise flex flex-col gap-3 rounded-2xl p-3 sm:flex-row sm:gap-5 sm:p-4",
        props.isToday ? "bg-card shadow-card ring-2 ring-coral" : "border border-line bg-card",
        !props.planned && "opacity-70",
      )}
    >
      <div className="flex shrink-0 items-baseline gap-2 sm:w-20 sm:flex-col sm:gap-0 sm:pt-1">
        <span
          className={cx("text-xs font-semibold uppercase tracking-wider", props.isToday ? "text-coral-deep" : "text-ink-faint")}
        >
          {props.isToday ? "Today" : dayShort(props.date)}
        </span>
        <span className="font-display text-3xl font-semibold">{dayOfMonth(props.date)}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {workouts.length > 0 ? (
          workouts.map((w) =>
            props.isToday ? (
              <TodayWorkout
                key={w.id}
                workout={w}
                done={setsDone(w, props.ticks)}
                lifts={props.lifts}
                unit={props.weightUnit}
                onOpen={() => props.onOpen(w.id)}
                onEdit={() => props.onEdit(w.id)}
              />
            ) : (
            <div key={w.id} className="flex flex-col gap-3 lg:flex-row">
              <div className="flex flex-col gap-2 lg:w-64 lg:shrink-0">
                <WorkoutCard workout={w} onOpen={() => props.onOpen(w.id)} />
                {props.showWhy && w.rationale && (
                  <p className="px-1 text-xs leading-relaxed text-ink-soft">
                    <span className="font-semibold text-ink">Why: </span>
                    {w.rationale}
                  </p>
                )}
              </div>
              <MovementList workout={w} done={setsDone(w, props.ticks)} />
            </div>
            ),
          )
        ) : (
          <p className="pt-2 text-sm text-ink-faint italic">{props.planned ? "Rest day" : "Not planned yet"}</p>
        )}
        {busy.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {busy.map((b) => (
              <span
                key={b.id}
                title={b.source === "blocked" ? "You told Pivot you can't work out now" : undefined}
                className={cx(
                  "rounded-full border px-2.5 py-0.5 text-[11px]",
                  b.source === "blocked"
                    ? "border-dashed border-coral/40 bg-coral-soft/40 text-coral-ink"
                    : "border-line bg-paper-deep/60 text-ink-faint",
                )}
              >
                <span className="font-semibold">{formatTime(b.start)}</span> {b.source === "blocked" ? "⊘ " : ""}
                {b.title}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Today's workout in the week view: each movement as a card with a check and
 * a tick per set, and a button to finish the whole workout. Only today's
 * workouts can be finished; other days are read-only.
 */
function TodayWorkout({
  workout,
  done,
  lifts,
  unit,
  onOpen,
  onEdit,
}: {
  workout: Workout;
  done: number[];
  lifts: ExerciseLog[];
  unit: WeightUnit;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const skipped = workout.status === "skipped";
  const completed = workout.status === "completed";
  const totalSets = workout.exercises.reduce((s, we) => s + setCount(we), 0);
  const doneSets = done.reduce((s, n) => s + n, 0);
  const movesDone = workout.exercises.filter((we, i) => done[i] >= setCount(we)).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <div className="sm:w-64 sm:shrink-0">
          <WorkoutCard workout={workout} onOpen={onOpen} />
        </div>
        <div className="flex flex-1 flex-col justify-end gap-3">
          <p className="text-sm text-ink-soft tabular-nums">
            <span className="font-display text-xl font-semibold text-ink">{movesDone}</span>/{workout.exercises.length}{" "}
            movements · {doneSets}/{totalSets} sets
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-paper-deep" aria-hidden>
            <div
              className="h-full rounded-full bg-sage transition-[width] duration-500"
              style={{ width: `${totalSets ? (doneSets / totalSets) * 100 : 0}%` }}
            />
          </div>
          {!skipped && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" className="h-9 px-4" onClick={onEdit}>
                Change movements
              </Button>
              {completed ? (
                <Button variant="secondary" className="h-9 px-4" onClick={() => pivot.setWorkoutStatus(workout.id, "planned")}>
                  Mark as not done
                </Button>
              ) : (
                <Button
                  className="h-9 px-4"
                  onClick={() => {
                    pivot.setWorkoutStatus(workout.id, "completed");
                    track("workout_status_changed", { status: "completed", category: workout.category });
                  }}
                >
                  <Check /> Finish workout
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {workout.exercises.map((we, i) => (
          <MovementCard
            key={`${we.exerciseId}-${i}`}
            we={we}
            index={i}
            done={done[i]}
            disabled={skipped}
            workoutId={workout.id}
            date={workout.date}
            lifts={lifts}
            unit={unit}
            onSetDone={(n) => pivot.setSetsDone(workout.id, i, n)}
          />
        ))}
      </ol>
    </div>
  );
}

/** Every movement of a workout, shown right in the week view: photo, name, and sets. */
function MovementList({ workout, done }: { workout: Workout; done: number[] }) {
  return (
    <ol className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      {workout.exercises.map((we, i) => {
        const ex = getExercise(we.exerciseId);
        const complete = done[i] >= setCount(we);
        return (
          <li
            key={`${we.exerciseId}-${i}`}
            className={cx(
              "flex flex-col overflow-hidden rounded-xl border bg-card",
              complete ? "border-sage ring-1 ring-sage/40" : "border-line",
              workout.status === "skipped" && "opacity-60",
            )}
          >
            <div className="relative">
              <ExerciseVisual exerciseId={we.exerciseId} className="w-full rounded-none" sizes="200px" />
              {complete && (
                <span
                  className="absolute top-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-full bg-sage text-white"
                  aria-label="Done"
                >
                  <Check width={14} height={14} />
                </span>
              )}
            </div>
            <div className="flex flex-col gap-0.5 px-2.5 py-2">
              <p
                className={cx("text-sm leading-snug font-semibold", complete && "text-ink-soft line-through decoration-sage/60")}
              >
                {ex?.name ?? we.exerciseId}
              </p>
              <p className="font-mono text-xs text-ink-soft">{prescription(we)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The first look at a new plan: what Pivot built and why, then out of the way. */
function PlanReveal({
  reasons,
  first,
  onDone,
}: {
  reasons: ReturnType<typeof revealReasons>;
  first: string;
  onDone: () => void;
}) {
  return (
    <Card className="animate-rise overflow-hidden p-0">
      <div className="flex flex-col gap-1 border-b border-line bg-paper-deep/50 px-5 py-4 sm:px-6">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-coral-deep">
          <Sparkle width={14} height={14} /> Why this plan
        </p>
        <p className="text-sm text-ink">{first}</p>
      </div>
      <ul className="grid gap-x-6 gap-y-4 px-5 py-5 sm:grid-cols-2 sm:px-6">
        {reasons.map((r) => (
          <li key={r.key} className="flex gap-3">
            <span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sage-soft text-sage-ink">
              <Check width={12} height={12} />
            </span>
            <div>
              <p className="text-sm font-semibold">{r.title}</p>
              <p className="text-sm text-ink-soft">{r.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 sm:px-6">
        <p className="text-xs text-ink-faint">Something off? Tell your coach below and Pivot will re-plan.</p>
        <Button variant="dark" className="h-9 px-4" onClick={onDone}>
          Looks good
        </Button>
      </div>
    </Card>
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
    <Card className="flex items-center gap-5 border-0 px-5 py-4">
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
        {result.ok
          ? "Fits your schedule"
          : `${result.violations.length} issue${result.violations.length > 1 ? "s" : ""}`}
      </button>
      {open && (
        <Card className="absolute top-9 left-0 z-20 w-80 animate-rise p-4 text-sm">
          <p className="mb-2 font-semibold">Schedule checks</p>
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

function EmptyState({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 px-5 py-24 text-center">
      <h1 className="font-display text-4xl font-medium tracking-tight">{title}</h1>
      <p className="text-ink-soft">{body}</p>
      {action}
    </div>
  );
}

export function WeekSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 sm:px-8" aria-busy="true">
      <Skeleton className="h-16 w-80" />
      <Skeleton className="h-48 w-full" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    </div>
  );
}
