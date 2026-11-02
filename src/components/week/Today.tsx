"use client";

import { formatFree } from "@/lib/capacity";
import { CATEGORY_STYLE, EQUIPMENT_LABELS } from "@/lib/labels";
import type { IsoDate, WeeklyPlan, Workout, WorkoutLogEntry } from "@/lib/schemas";
import { pivot } from "@/lib/store";
import { dayLong, monthDay } from "@/lib/time";
import { CategoryIcon, Check, Sparkle } from "../icons";
import { Button, Card, cx } from "../ui";
import { BodyMap } from "./BodyMap";
import { ExerciseStep } from "./ExerciseStep";

/** Consecutive completed workouts, newest first; today's unfinished one doesn't break it. */
export function streakOf(plan: WeeklyPlan, log: WorkoutLogEntry[], today: IsoDate): number {
  const outcomes = new Map<string, { date: IsoDate; done: boolean }>();
  for (const e of log) outcomes.set(e.workoutId, { date: e.date, done: e.status === "completed" });
  for (const w of plan.workouts) {
    if (w.status !== "planned") outcomes.set(w.id, { date: w.date, done: w.status === "completed" });
    else if (w.date < today) outcomes.set(w.id, { date: w.date, done: false });
  }
  let n = 0;
  for (const o of [...outcomes.values()].sort((a, b) => b.date.localeCompare(a.date))) {
    if (!o.done) break;
    n++;
  }
  return n;
}

function Ring({ value, total, size = 112 }: { value: number; total: number; size?: number }) {
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  const pct = total ? value / total : 0;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-paper-deep)" strokeWidth="10" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={pct >= 1 ? "var(--color-sage)" : "var(--color-coral)"}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className="transition-[stroke-dashoffset,stroke] duration-500"
        />
      </svg>
      <div className="absolute text-center">
        {pct >= 1 ? (
          <Check width={34} height={34} className="text-sage" />
        ) : (
          <p className="font-display text-3xl font-semibold tabular-nums">
            {value}
            <span className="text-lg text-ink-faint">/{total}</span>
          </p>
        )}
      </div>
    </div>
  );
}

export function Today(props: {
  plan: WeeklyPlan;
  today: IsoDate;
  steps: Record<string, number[]>;
  freeToday: number;
  streak: number;
  onOpen: (id: string) => void;
}) {
  const { plan, today } = props;
  const workout = plan.workouts.find((w) => w.date === today && w.status !== "skipped");
  const skipped = plan.workouts.find((w) => w.date === today && w.status === "skipped");
  const next = plan.workouts.find((w) => w.date > today && w.status === "planned");

  if (!workout) return <RestDay today={today} skipped={skipped} next={next} streak={props.streak} onOpen={props.onOpen} />;

  const style = CATEGORY_STYLE[workout.category];
  const done = workout.status === "completed";
  const ticked = new Set(done ? workout.exercises.map((_, i) => i) : (props.steps[workout.id] ?? []));

  return (
    <section aria-labelledby="today-title" className="animate-rise">
      <Card className="overflow-hidden">
        <div className={cx("relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8", style.soft)}>
          <div aria-hidden className="pointer-events-none absolute -top-16 -right-10 h-56 w-56 rounded-full bg-card/40" />
          <div className="relative flex flex-col gap-2">
            <p className={cx("inline-flex items-center gap-1.5 text-sm font-semibold", style.text)}>
              <CategoryIcon category={workout.category} /> Today · {style.label}
            </p>
            <h2 id="today-title" className="font-display text-4xl leading-tight font-semibold sm:text-5xl">
              {workout.title}
            </h2>
            <p className="text-sm text-ink-soft">
              {workout.durationMin} min · {workout.exercises.length} exercise{workout.exercises.length > 1 ? "s" : ""} · any time today
              {!done && props.freeToday > 0 && <> · you have {formatFree(props.freeToday).replace(" free", "")} free</>}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {props.streak > 0 && (
                <span className="rounded-full bg-card/80 px-2.5 py-1 text-xs font-semibold text-ink">
                  🔥 {props.streak} in a row
                </span>
              )}
              {workout.equipment.length ? (
                workout.equipment.map((e) => (
                  <span key={e} className="rounded-full bg-card/60 px-2.5 py-1 text-xs text-ink-soft">
                    {EQUIPMENT_LABELS[e]}
                  </span>
                ))
              ) : (
                <span className="rounded-full bg-card/60 px-2.5 py-1 text-xs text-ink-soft">No equipment</span>
              )}
            </div>
          </div>
          <div className="relative flex items-center gap-5">
            <Ring value={ticked.size} total={workout.exercises.length} />
            <div className="flex flex-col gap-2">
              {done ? (
                <>
                  <p className="font-display text-xl font-semibold text-sage-ink">Done for today</p>
                  <Button variant="secondary" className="h-9 text-xs" onClick={() => pivot.setWorkoutStatus(workout.id, "planned")}>
                    Undo
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={() => pivot.setWorkoutStatus(workout.id, "completed")}>
                    <Check /> I did it
                  </Button>
                  <a href="#life-happens-title" className="text-center text-xs font-medium text-ink-soft underline-offset-4 hover:underline">
                    Can&apos;t today?
                  </a>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[1fr_240px]">
          <div>
            <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Tick off each exercise as you go
            </p>
            <ol className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line">
              {workout.exercises.map((we, i) => (
                <ExerciseStep
                  key={`${we.exerciseId}-${i}`}
                  we={we}
                  index={i}
                  done={ticked.has(i)}
                  onToggle={done ? undefined : () => pivot.toggleStep(workout.id, i)}
                />
              ))}
            </ol>
            <p className="mt-3 px-1 text-sm leading-relaxed text-ink-soft">{workout.rationale}</p>
          </div>
          <aside className="flex flex-col items-center gap-4 rounded-2xl bg-paper-deep/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">What you&apos;ll work</p>
            <BodyMap muscles={workout.muscles} />
            <button type="button" onClick={() => props.onOpen(workout.id)} className="text-xs font-medium text-ink-soft underline-offset-4 hover:underline">
              Workout details
            </button>
          </aside>
        </div>
      </Card>
    </section>
  );
}

function RestDay(props: { today: IsoDate; skipped?: Workout; next?: Workout; streak: number; onOpen: (id: string) => void }) {
  return (
    <section aria-label="Today" className="animate-rise">
      <Card className="flex flex-col gap-6 overflow-hidden p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="flex items-center gap-5">
          <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-sage-soft text-4xl" aria-hidden>
            {props.skipped ? "🌙" : "🌿"}
          </div>
          <div>
            <p className="text-sm font-semibold text-sage-ink">Today · {dayLong(props.today)}, {monthDay(props.today)}</p>
            <h2 className="font-display text-3xl font-semibold sm:text-4xl">{props.skipped ? "Taking today off" : "Rest day"}</h2>
            <p className="mt-1 text-sm text-ink-soft">
              {props.skipped
                ? `You skipped ${props.skipped.title.toLowerCase()}. Rest is a legitimate choice.`
                : "Nothing planned. Recovery is part of training."}
              {props.streak > 0 && ` 🔥 ${props.streak} in a row so far.`}
            </p>
            {props.skipped && (
              <button
                type="button"
                onClick={() => pivot.setWorkoutStatus(props.skipped!.id, "planned")}
                className="mt-2 text-xs font-semibold text-coral-deep underline-offset-4 hover:underline"
              >
                Changed my mind, I&apos;ll do it
              </button>
            )}
          </div>
        </div>
        {props.next && (
          <button
            type="button"
            onClick={() => props.onOpen(props.next!.id)}
            className={cx(
              "flex items-center gap-3 rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lift",
              CATEGORY_STYLE[props.next.category].soft,
              CATEGORY_STYLE[props.next.category].border,
            )}
          >
            <Sparkle width={18} height={18} className={CATEGORY_STYLE[props.next.category].text} />
            <span>
              <span className="block text-xs font-semibold uppercase tracking-wider text-ink-faint">Up next · {dayLong(props.next.date)}</span>
              <span className="font-display text-lg font-semibold">{props.next.title}</span>
              <span className="text-sm text-ink-soft"> · {props.next.durationMin} min</span>
            </span>
          </button>
        )}
      </Card>
    </section>
  );
}
