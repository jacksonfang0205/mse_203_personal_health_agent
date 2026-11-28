"use client";

import { demoVideoUrl, getExercise } from "@/lib/catalog";
import { isLoggable, usesWeight } from "@/lib/progression";
import type { ExerciseLog, IsoDate, WeightUnit, Workout, WorkoutExercise } from "@/lib/schemas";
import { pivot, setCount } from "@/lib/store";
import { Check } from "../icons";
import { cx } from "../ui";
import { ExerciseVisual } from "./ExerciseVisual";
import { SetLogger, targetFor } from "./SetLogger";

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

/** One movement of today's workout: photo, prescription, one check for the whole movement, and a logger per set. */
export function MovementCard(props: {
  we: WorkoutExercise;
  index: number;
  done: number;
  disabled: boolean;
  workoutId: string;
  date: IsoDate;
  lifts: ExerciseLog[];
  unit: WeightUnit;
  onSetDone: (n: number) => void;
}) {
  const ex = getExercise(props.we.exerciseId);
  const name = ex?.name ?? props.we.exerciseId;
  const total = setCount(props.we);
  const complete = props.done >= total;

  const toggle = () => {
    if (!complete && isLoggable(props.we)) {
      // Checking the movement means "did it as planned": sets left empty log today's target.
      const { target } = targetFor(props.we, props.lifts, props.date, props.unit);
      const entry = props.lifts.find(
        (l) => l.workoutId === props.workoutId && l.exerciseIndex === props.index && l.exerciseId === props.we.exerciseId,
      );
      const weight = usesWeight(ex) ? target.weight : null;
      for (let k = 0; k < total; k++) {
        if (!entry?.sets[k]) {
          pivot.logSet({ workoutId: props.workoutId, exerciseIndex: props.index, exerciseId: props.we.exerciseId, date: props.date, setIndex: k, set: { reps: target.reps, weight } });
        }
      }
    }
    props.onSetDone(complete ? 0 : total);
  };

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
            onChange={toggle}
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
        {isLoggable(props.we) && (
          <SetLogger
            workoutId={props.workoutId}
            date={props.date}
            index={props.index}
            we={props.we}
            total={total}
            done={props.done}
            disabled={props.disabled}
            lifts={props.lifts}
            unit={props.unit}
          />
        )}
        {ex && (
          <a
            href={demoVideoUrl(ex)}
            target="_blank"
            rel="noopener noreferrer"
            className={cx("text-xs font-semibold text-coral-deep underline-offset-4 hover:underline", !isLoggable(props.we) && "mt-auto")}
          >
            Watch a form demo ↗
          </a>
        )}
      </div>
    </li>
  );
}
