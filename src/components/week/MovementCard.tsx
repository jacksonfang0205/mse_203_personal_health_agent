"use client";

import { demoVideoUrl, getExercise } from "@/lib/catalog";
import type { Workout, WorkoutExercise } from "@/lib/schemas";
import { setCount } from "@/lib/store";
import { Check } from "../icons";
import { cx } from "../ui";
import { ExerciseVisual } from "./ExerciseVisual";

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

/** One movement of today's workout: photo, prescription, a check for the whole movement and a tick per set. */
export function MovementCard(props: {
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
