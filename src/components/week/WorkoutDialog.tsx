"use client";

import { useEffect, useRef } from "react";
import { CATEGORY_STYLE, EQUIPMENT_LABELS } from "@/lib/labels";
import type { Workout, WorkoutStatus } from "@/lib/schemas";
import { pivot, usePivotState } from "@/lib/store";
import { dayLong, monthDay } from "@/lib/time";
import { CategoryIcon, Check, SkipIcon } from "../icons";
import { Button, MockBadge, cx } from "../ui";
import { BodyMap } from "./BodyMap";
import { ExerciseStep } from "./ExerciseStep";
import { StatusPill } from "./WorkoutCard";

const ORIGIN_LABEL: Record<Workout["origin"], string> = {
  mock_template: "Sample workout from a template",
  rule_based: "Rule-based adjustment (preview)",
  agent: "Planned by Pivot AI",
  user: "Added by you",
};

export function WorkoutDialog({
  workout,
  onClose,
  onStatus,
}: {
  workout: Workout | null;
  onClose: () => void;
  onStatus: (status: WorkoutStatus) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const steps = usePivotState()?.steps ?? {};

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (workout && !d.open) d.showModal();
    if (!workout && d.open) d.close();
  }, [workout]);

  const style = workout ? CATEGORY_STYLE[workout.category] : null;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(100%-2rem,40rem)] max-h-[90dvh] overflow-y-auto rounded-[var(--radius-card)] bg-card p-0 text-ink shadow-lift"
    >
      {workout && style && (
        <div className="animate-fade">
          <div className={cx("flex flex-col gap-3 p-6 sm:p-8", style.soft)}>
            <div className="flex items-center justify-between">
              <span className={cx("inline-flex items-center gap-1.5 text-sm font-semibold", style.text)}>
                <CategoryIcon category={workout.category} /> {style.label}
              </span>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-ink-soft hover:bg-ink/5">
                <SkipIcon />
              </button>
            </div>
            <h2 className="font-display text-3xl leading-tight font-semibold">{workout.title}</h2>
            <p className="text-sm text-ink-soft">
              {dayLong(workout.date)}, {monthDay(workout.date)} · {workout.durationMin} min · any time that day
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={workout.status} />
              {workout.origin !== "agent" && <MockBadge>{ORIGIN_LABEL[workout.origin]}</MockBadge>}
            </div>
          </div>

          <div className="flex flex-col gap-6 p-6 sm:p-8">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Why this workout</h3>
              <p className="text-[15px] leading-relaxed">{workout.rationale}</p>
            </section>

            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-faint">Exercises</h3>
              <ol className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line">
                {workout.exercises.map((we, i) => (
                  <ExerciseStep
                    key={`${we.exerciseId}-${i}`}
                    we={we}
                    index={i}
                    done={workout.status === "completed" || (steps[workout.id] ?? []).includes(i)}
                    onToggle={workout.status === "planned" ? () => pivot.toggleStep(workout.id, i) : undefined}
                  />
                ))}
              </ol>
              <p className="mt-2 text-xs text-ink-faint">
                Sets and reps are starting points. Pick a weight that leaves a couple of reps in reserve.
              </p>
            </section>

            <div className="grid items-start gap-4 sm:grid-cols-2">
              <section className="flex flex-col items-center rounded-2xl bg-paper-deep/40 p-4">
                <BodyMap muscles={workout.muscles} />
              </section>
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Equipment</h3>
                <p className="text-sm">
                  {workout.equipment.length ? workout.equipment.map((e) => EQUIPMENT_LABELS[e]).join(", ") : "None. Bodyweight only."}
                </p>
              </section>
            </div>

            <div className="flex flex-wrap gap-3 border-t border-line pt-6">
              {workout.status === "planned" ? (
                <>
                  <Button onClick={() => onStatus("completed")}>
                    <Check /> Mark complete
                  </Button>
                  <Button variant="secondary" onClick={() => onStatus("skipped")}>
                    Skip this one
                  </Button>
                </>
              ) : (
                <Button variant="secondary" onClick={() => onStatus("planned")}>
                  {workout.status === "completed" ? "Mark as not done" : "Un-skip"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
