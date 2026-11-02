import { demoVideoUrl, getExercise } from "@/lib/catalog";
import type { WorkoutExercise } from "@/lib/schemas";
import { Check } from "../icons";
import { cx } from "../ui";
import { ExerciseVisual } from "./ExerciseVisual";

export function prescription(we: WorkoutExercise): string {
  if (we.minutes) return `${we.minutes} min`;
  if (we.sets && we.reps) return `${we.sets} × ${we.reps}`;
  if (we.sets && we.seconds) return `${we.sets} × ${we.seconds} s`;
  return "";
}

/** One exercise as a checkable step: photo, what to do, and a form-demo link. */
export function ExerciseStep(props: {
  we: WorkoutExercise;
  index: number;
  done: boolean;
  /** Omit to show the step read-only. */
  onToggle?: () => void;
}) {
  const ex = getExercise(props.we.exerciseId);
  return (
    <li className={cx("flex items-center gap-3 p-3 transition-colors sm:gap-4 sm:p-4", props.done && "bg-sage-soft/50")}>
      {props.onToggle && (
        <button
          type="button"
          onClick={props.onToggle}
          aria-pressed={props.done}
          aria-label={`${props.done ? "Untick" : "Tick off"} ${ex?.name ?? "exercise"}`}
          className={cx(
            "grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 transition-all duration-200 active:scale-90",
            props.done ? "border-sage bg-sage text-white" : "border-line-strong bg-card text-transparent hover:border-sage",
          )}
        >
          <Check width={16} height={16} />
        </button>
      )}
      {!props.onToggle && props.done && (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sage text-white" aria-label="Done">
          <Check width={16} height={16} />
        </span>
      )}
      <ExerciseVisual exerciseId={props.we.exerciseId} className="w-20 shrink-0 sm:w-36" sizes="(min-width: 640px) 144px, 80px" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className={cx("font-semibold", props.done && "text-ink-soft line-through decoration-sage/60")}>
            <span className="mr-1.5 font-mono text-xs text-ink-faint">{props.index + 1}</span>
            {ex?.name ?? props.we.exerciseId}
          </p>
          <span className="font-mono text-sm font-semibold text-ink">{prescription(props.we)}</span>
        </div>
        {ex && <p className="mt-0.5 text-sm text-ink-soft">{ex.cue}</p>}
        {ex && (
          <a
            href={demoVideoUrl(ex)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-xs font-semibold text-coral-deep underline-offset-4 hover:underline"
          >
            Watch a form demo ↗
          </a>
        )}
      </div>
    </li>
  );
}
