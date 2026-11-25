"use client";

import { useEffect, useRef, useState } from "react";
import { demoVideoUrl, getExercise } from "@/lib/catalog";
import { CATEGORY_STYLE, EQUIPMENT_LABELS, MUSCLE_LABELS } from "@/lib/labels";
import { rationaleFor } from "@/lib/planner/move";
import { formatTarget, isLoggable } from "@/lib/progression";
import type { ExerciseLog, FitnessProfile, IsoDate, WeightUnit, Workout, WorkoutExercise, WorkoutStatus } from "@/lib/schemas";
import { doneBlockedReason } from "@/lib/workoutStatus";
import { dayLong, formatRange, monthDay } from "@/lib/time";
import { CategoryIcon, Check, SkipIcon } from "../icons";
import { Button, MockBadge, cx } from "../ui";
import { MovementEditor, toEditItems, type EditItem } from "./MovementEditor";
import { targetFor } from "./SetLogger";
import { StatusPill } from "./WorkoutCard";

function prescription(we: WorkoutExercise): string {
  if (we.minutes) return `${we.minutes} min`;
  if (we.sets && we.reps) return `${we.sets} × ${we.reps}`;
  if (we.sets && we.seconds) return `${we.sets} × ${we.seconds} s`;
  return "";
}

const ORIGIN_LABEL: Record<Workout["origin"], string> = {
  mock_template: "Planned by Pivot",
  rule_based: "Adjusted by Pivot",
  agent: "Planned by Pivot",
  user: "Your movements",
};

export function WorkoutDialog({
  workout,
  today,
  note,
  lifts = [],
  weightUnit = "lb",
  profile,
  startEditing = false,
  onClose,
  onStatus,
  onSaveExercises,
}: {
  workout: Workout | null;
  today: IsoDate;
  /** Why the last status change was refused, if it was. */
  note?: string | null;
  lifts?: ExerciseLog[];
  weightUnit?: WeightUnit;
  profile: FitnessProfile | null;
  /** Open straight into "Change movements". */
  startEditing?: boolean;
  onClose: () => void;
  onStatus: (status: WorkoutStatus) => void;
  /** `from[i]` is where movement i was before the edit, or -1 if it's new. */
  onSaveExercises: (exercises: WorkoutExercise[], from: number[]) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // The movements being edited; null when just viewing.
  const [edit, setEdit] = useState<EditItem[] | null>(null);
  const workoutId = workout?.id ?? null;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (workout && !d.open) d.showModal();
    if (!workout && d.open) d.close();
  }, [workout]);

  // Opening a workout resets the editor; "Change movements" on a card opens it in edit mode.
  // Only when a different workout opens, not on every change to the open one.
  const openKey = `${workoutId}|${startEditing}`;
  const [seenKey, setSeenKey] = useState(openKey);
  if (seenKey !== openKey) {
    setSeenKey(openKey);
    setEdit(workout && startEditing ? toEditItems(workout.exercises) : null);
  }

  const save = () => {
    if (!edit?.length) return;
    onSaveExercises(
      edit.map((it) => (it.we.reps !== undefined && !it.we.reps.trim() ? { ...it.we, reps: "10" } : it.we)),
      edit.map((it) => it.from),
    );
    setEdit(null);
  };

  const style = workout ? CATEGORY_STYLE[workout.category] : null;
  const tooEarly = workout ? doneBlockedReason(workout, today) : null;

  return (
    <dialog
      ref={ref}
      onClose={(e) => e.target === ref.current && onClose()}
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
              {dayLong(workout.date)}, {monthDay(workout.date)} · {formatRange(workout.start, workout.durationMin)} ·{" "}
              {workout.durationMin} min
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={workout.status} />
              {workout.origin !== "agent" && <MockBadge>{ORIGIN_LABEL[workout.origin]}</MockBadge>}
            </div>
          </div>

          <div className="flex flex-col gap-6 p-6 sm:p-8">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Why this workout</h3>
              <p className="text-[15px] leading-relaxed">{rationaleFor(workout)}</p>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                  {edit ? "Change movements" : "Exercises"}
                </h3>
                {!edit && (
                  <button
                    type="button"
                    onClick={() => setEdit(toEditItems(workout.exercises))}
                    className="text-sm font-semibold text-coral-deep underline-offset-4 hover:underline"
                  >
                    Change movements
                  </button>
                )}
              </div>
              {edit ? (
                <div className="flex flex-col gap-4">
                  <MovementEditor items={edit} onChange={setEdit} profile={profile} />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={save} disabled={!edit.length}>
                      <Check /> Save movements
                    </Button>
                    <Button variant="ghost" onClick={() => setEdit(null)}>
                      Cancel
                    </Button>
                    {!edit.length && <p className="text-sm text-coral-deep">Keep at least one movement.</p>}
                  </div>
                </div>
              ) : (
                <ol className="flex flex-col divide-y divide-line rounded-2xl border border-line">
                  {workout.exercises.map((we, i) => {
                    const ex = getExercise(we.exerciseId);
                    // Only worth showing once there's history to build on.
                    const next = isLoggable(we) ? targetFor(we, lifts, workout.date, weightUnit) : null;
                    const target = next?.history.length ? next.target : null;
                    return (
                      <li key={`${we.exerciseId}-${i}`} className="flex items-start justify-between gap-4 px-4 py-3">
                        <div>
                          <p className="font-medium">{ex?.name ?? we.exerciseId}</p>
                          {ex && <p className="text-sm text-ink-soft">{ex.cue}</p>}
                          {target && (
                            <p className="mt-1 text-xs text-ink-soft">
                              <span className="font-semibold text-ink">Target: {formatTarget(target)}</span> · {target.reason}
                            </p>
                          )}
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
                        <span className="shrink-0 font-mono text-sm text-ink-soft">{prescription(we)}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            <div className="grid gap-4 sm:grid-cols-2">
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Targets</h3>
                <p className="text-sm">{workout.muscles.map((m) => MUSCLE_LABELS[m]).join(", ")}</p>
              </section>
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Equipment</h3>
                <p className="text-sm">
                  {workout.equipment.length ? workout.equipment.map((e) => EQUIPMENT_LABELS[e]).join(", ") : "None. Bodyweight only."}
                </p>
              </section>
            </div>

            <div className={cx("flex flex-wrap gap-3 border-t border-line pt-6", edit && "hidden")}>
              {workout.status === "planned" ? (
                <>
                  <Button onClick={() => onStatus("completed")} disabled={!!tooEarly} title={tooEarly ?? undefined}>
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
              {(tooEarly || note) && workout.status === "planned" && (
                <p role="status" className="basis-full text-sm text-ink-soft">
                  {tooEarly ?? note}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
