"use client";

import type { ReactNode } from "react";
import { demoVideoUrl, getExercise } from "@/lib/catalog";
import { CATEGORY_STYLE } from "@/lib/labels";
import type { BusyBlock, IsoDate, WeeklyPlan, Workout, WorkoutExercise } from "@/lib/schemas";
import { pivot, setCount } from "@/lib/store";
import { dayLong, formatRange, formatTime, monthDay, toMinutes } from "@/lib/time";
import { CalendarIcon, CategoryIcon, Check, Clock } from "../icons";
import { Button, Card, cx } from "../ui";
import { ExerciseVisual } from "./ExerciseVisual";
import { StatusPill } from "./WorkoutCard";

export function prescription(we: WorkoutExercise): string {
  if (we.minutes) return `${we.minutes} min`;
  if (we.sets && we.reps) return `${we.sets} × ${we.reps}`;
  if (we.sets && we.seconds) return `${we.sets} × ${we.seconds} s`;
  return "";
}

/** Sets done per exercise: stored ticks, or every set when the workout is marked complete. */
export function setsDone(w: Workout, ticks: Record<string, number[]>): number[] {
  return w.exercises.map((we, i) => {
    const total = setCount(we);
    return Math.min(total, ticks[w.id]?.[i] ?? (w.status === "completed" ? total : 0));
  });
}

/**
 * The default "My week" view: today's workouts, each movement as a card with a
 * picture and a checkbox. Ticking sets is saved, and finishing every movement
 * completes the workout.
 */
export function TodayView(props: {
  today: IsoDate;
  plan: WeeklyPlan;
  ticks: Record<string, number[]>;
  busy: BusyBlock[];
  onOpen: (id: string) => void;
  onSwitchToWeek: () => void;
}) {
  const workouts = props.plan.workouts
    .filter((w) => w.date === props.today)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const next = props.plan.workouts
    .filter((w) => w.date > props.today && w.status === "planned")
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];

  return (
    <section aria-label="Today" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-medium">
          Today{" "}
          <span className="text-ink-faint">
            · {dayLong(props.today)}, {monthDay(props.today)}
          </span>
        </h2>
        <SwitchButton onClick={props.onSwitchToWeek}>Switch to week view</SwitchButton>
      </div>

      {workouts.length === 0 && (
        <Card className="flex flex-col gap-3 p-6 sm:p-8">
          <p className="font-display text-2xl font-medium">Rest day.</p>
          <p className="text-ink-soft">Nothing is planned for today. Recovery is part of the plan.</p>
          {next && (
            <button
              type="button"
              onClick={() => props.onOpen(next.id)}
              className="mt-1 self-start text-sm font-semibold text-coral-deep underline-offset-4 hover:underline"
            >
              Next up: {next.title}, {dayLong(next.date)} at {formatTime(next.start)} →
            </button>
          )}
        </Card>
      )}

      {workouts.map((w) => (
        <TodayWorkout key={w.id} workout={w} done={setsDone(w, props.ticks)} onOpen={() => props.onOpen(w.id)} />
      ))}

      {props.busy.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
          <CalendarIcon width={14} height={14} />
          <span className="font-semibold">Also today (simulated calendar):</span>
          {props.busy
            .slice()
            .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
            .map((b) => (
              <span key={b.id} className="rounded-full border border-line bg-paper-deep/60 px-2.5 py-0.5">
                {formatTime(b.start)} {b.title}
              </span>
            ))}
        </div>
      )}
    </section>
  );
}

function TodayWorkout({ workout, done, onOpen }: { workout: Workout; done: number[]; onOpen: () => void }) {
  const style = CATEGORY_STYLE[workout.category];
  const skipped = workout.status === "skipped";
  const totalSets = workout.exercises.reduce((s, we) => s + setCount(we), 0);
  const doneSets = done.reduce((s, n) => s + n, 0);
  const movesDone = workout.exercises.filter((we, i) => done[i] >= setCount(we)).length;

  return (
    <div
      className={cx(
        "flex flex-col gap-4 rounded-[var(--radius-card)] border p-4 sm:p-5",
        style.soft,
        style.border,
        skipped && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <span className={cx("inline-flex items-center gap-1.5 text-xs font-semibold", style.text)}>
            <CategoryIcon category={workout.category} width={15} height={15} />
            {style.label}
            <StatusPill status={workout.status} />
          </span>
          <h3 className={cx("font-display text-2xl leading-snug font-semibold", skipped && "line-through decoration-ink/30")}>
            {workout.title}
          </h3>
          <p className="flex items-center gap-1.5 text-sm text-ink-soft">
            <Clock width={14} height={14} />
            {formatRange(workout.start, workout.durationMin)} · {workout.durationMin} min
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <p className="text-sm text-ink-soft tabular-nums">
            <span className="font-display text-xl font-semibold text-ink">{movesDone}</span>/{workout.exercises.length} movements
            · {doneSets}/{totalSets} sets
          </p>
          <Button variant="secondary" className="h-8 px-3.5 text-xs" onClick={onOpen}>
            {skipped ? "Details · un-skip" : "Details"}
          </Button>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-card/80" aria-hidden>
        <div
          className="h-full rounded-full bg-sage transition-[width] duration-500"
          style={{ width: `${totalSets ? (doneSets / totalSets) * 100 : 0}%` }}
        />
      </div>

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {workout.exercises.map((we, i) => (
          <MovementCard
            key={`${we.exerciseId}-${i}`}
            we={we}
            index={i}
            done={done[i]}
            disabled={skipped}
            onSetDone={(n) => pivot.setSetsDone(workout.id, i, n)}
          />
        ))}
      </ol>
    </div>
  );
}

function MovementCard(props: {
  we: WorkoutExercise;
  index: number;
  done: number;
  disabled: boolean;
  onSetDone: (n: number) => void;
}) {
  const ex = getExercise(props.we.exerciseId);
  const name = ex?.name ?? props.we.exerciseId;
  const total = setCount(props.we);
  const complete = props.done >= total;

  return (
    <li
      className={cx(
        "flex flex-col overflow-hidden rounded-2xl border bg-card shadow-card transition-all duration-200",
        complete ? "border-sage ring-2 ring-sage/40" : "border-line",
      )}
    >
      <div className="relative">
        <ExerciseVisual
          exerciseId={props.we.exerciseId}
          className="w-full rounded-none"
          sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"
        />
        <label
          className={cx(
            "absolute top-3 right-3 grid h-10 w-10 cursor-pointer place-items-center rounded-full border-2 shadow-card transition-all duration-200 active:scale-90",
            complete ? "border-sage bg-sage text-white" : "border-white bg-card/90 text-transparent hover:border-sage",
            props.disabled && "pointer-events-none opacity-50",
          )}
        >
          <input
            type="checkbox"
            className="sr-only"
            checked={complete}
            disabled={props.disabled}
            onChange={() => props.onSetDone(complete ? 0 : total)}
            aria-label={`${name} done`}
          />
          <Check width={20} height={20} />
        </label>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className={cx("font-semibold", complete && "text-ink-soft line-through decoration-sage/60")}>
            <span className="mr-1.5 font-mono text-xs text-ink-faint">{props.index + 1}</span>
            {name}
          </p>
          <span className="shrink-0 font-mono text-sm font-semibold">{prescription(props.we)}</span>
        </div>
        {ex && <p className="text-sm text-ink-soft">{ex.cue}</p>}
        {total > 1 && (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-1" role="group" aria-label={`${name} sets`}>
            {Array.from({ length: total }, (_, k) => {
              const on = props.done > k;
              return (
                <button
                  key={k}
                  type="button"
                  disabled={props.disabled}
                  aria-pressed={on}
                  onClick={() => props.onSetDone(on ? k : k + 1)}
                  className={cx(
                    "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition-colors",
                    on ? "border-sage bg-sage text-white" : "border-line-strong bg-card text-ink-soft hover:border-sage",
                  )}
                >
                  {on && <Check width={12} height={12} />}
                  Set {k + 1}
                </button>
              );
            })}
          </div>
        )}
        {ex && (
          <a
            href={demoVideoUrl(ex)}
            target="_blank"
            rel="noopener noreferrer"
            className={cx("text-xs font-semibold text-coral-deep underline-offset-4 hover:underline", total <= 1 && "mt-auto")}
          >
            Watch a form demo ↗
          </a>
        )}
      </div>
    </li>
  );
}

export function SwitchButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-card px-3.5 py-1.5 text-xs font-semibold text-ink hover:border-ink/40"
    >
      <CalendarIcon width={14} height={14} />
      {children}
    </button>
  );
}
