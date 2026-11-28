"use client";

import { useState } from "react";
import { getExercise } from "@/lib/catalog";
import {
  estimatedMax,
  formatSets,
  formatTarget,
  sessionsFor,
  suggestTarget,
  usesWeight,
  type Session,
  type Target,
} from "@/lib/progression";
import type { ExerciseLog, IsoDate, LoggedSet, WeightUnit, WorkoutExercise } from "@/lib/schemas";
import { pivot } from "@/lib/store";
import { monthDay } from "@/lib/time";
import { Sparkle } from "../icons";
import { cx } from "../ui";

/** Today's target for a movement, from the user's lift history before `date`. */
export function targetFor(we: WorkoutExercise, lifts: ExerciseLog[], date: IsoDate, unit: WeightUnit): { target: Target; history: Session[] } {
  const history = sessionsFor(lifts, we.exerciseId, date);
  return { target: suggestTarget(we, history, unit), history };
}

/**
 * Per-set logging on a Today movement card: reps and weight for each set,
 * prefilled with a target built from the last sessions. There is no tick per
 * set: the movement's own check marks it done (see MovementCard), and sets
 * left empty then log the target.
 */
export function SetLogger(props: {
  workoutId: string;
  date: IsoDate;
  index: number;
  we: WorkoutExercise;
  total: number;
  done: number;
  disabled: boolean;
  lifts: ExerciseLog[];
  unit: WeightUnit;
}) {
  const ex = getExercise(props.we.exerciseId);
  const name = ex?.name ?? props.we.exerciseId;
  const weighted = usesWeight(ex);
  const { target, history } = targetFor(props.we, props.lifts, props.date, props.unit);
  const entry = props.lifts.find((l) => l.workoutId === props.workoutId && l.exerciseIndex === props.index && l.exerciseId === props.we.exerciseId);
  const [showHistory, setShowHistory] = useState(false);

  const save = (k: number, set: LoggedSet | null) =>
    pivot.logSet({ workoutId: props.workoutId, exerciseIndex: props.index, exerciseId: props.we.exerciseId, date: props.date, setIndex: k, set });

  return (
    <div className="mt-auto flex flex-col gap-2 pt-1">
      <div className="rounded-xl bg-paper-deep/70 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <Sparkle width={12} height={12} className="text-coral-deep" />
          {target.kind === "first" ? "Starting point" : "Today's target"}:{" "}
          <span className="font-mono">{formatTarget(target)}</span>
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{target.reason}</p>
      </div>

      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        <span>{target.timed ? "Seconds" : "Reps"}{weighted && " × weight"}</span>
        {weighted && (
          <span className="inline-flex overflow-hidden rounded-full border border-line-strong normal-case tracking-normal" role="group" aria-label="Weight unit">
            {(["lb", "kg"] as const).map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={props.unit === u}
                onClick={() => pivot.setWeightUnit(u)}
                className={cx("px-2 py-0.5", props.unit === u ? "bg-ink text-paper" : "bg-card text-ink-soft")}
              >
                {u}
              </button>
            ))}
          </span>
        )}
      </div>

      <ol className="flex flex-col gap-1.5" aria-label={`${name} sets`}>
        {Array.from({ length: props.total }, (_, k) => (
          <SetRow
            key={`${entry?.unit ?? ""}-${k}`}
            k={k}
            name={name}
            target={target}
            weighted={weighted}
            logged={entry?.sets[k] ?? null}
            loggedUnit={entry?.unit ?? props.unit}
            on={props.done >= props.total}
            disabled={props.disabled}
            onSave={(set) => save(k, set)}
          />
        ))}
      </ol>

      {history.length > 0 && (
        <div className="text-xs">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            className="font-semibold text-ink-soft underline-offset-4 hover:underline"
          >
            {showHistory ? "Hide history" : `History (${history.length})`}
          </button>
          {showHistory && <History sessions={history} unit={props.unit} timed={target.timed} />}
        </div>
      )}
    </div>
  );
}

function SetRow(props: {
  k: number;
  name: string;
  target: Target;
  weighted: boolean;
  logged: LoggedSet | null;
  loggedUnit: WeightUnit;
  on: boolean;
  disabled: boolean;
  onSave: (set: LoggedSet | null) => void;
}) {
  const [reps, setReps] = useState(props.logged ? String(props.logged.reps) : "");
  const [weight, setWeight] = useState(props.logged?.weight != null ? String(props.logged.weight) : "");
  // Checking the movement logs the target into empty rows; show it here too.
  const [seen, setSeen] = useState(props.logged);
  if (props.logged !== seen) {
    setSeen(props.logged);
    if (props.logged && !reps.trim() && !weight.trim()) {
      setReps(String(props.logged.reps));
      setWeight(props.logged.weight != null ? String(props.logged.weight) : "");
    }
  }

  const commit = (r: string, w: string) => {
    const repsN = Number.parseInt(r, 10);
    const weightN = Number.parseFloat(w);
    if (!r.trim() && !w.trim()) return props.onSave(null);
    props.onSave({
      reps: Number.isFinite(repsN) && repsN >= 0 ? Math.min(999, repsN) : props.target.reps,
      weight: props.weighted && Number.isFinite(weightN) && weightN > 0 ? Math.min(2000, weightN) : null,
    });
  };

  const input =
    "h-8 w-full min-w-0 rounded-lg border border-line-strong bg-card px-2 text-center font-mono text-sm tabular-nums placeholder:text-ink-faint/70 focus:border-coral focus:outline-none disabled:opacity-50";

  return (
    <li className={cx("flex items-center gap-1.5 rounded-lg px-1 py-0.5", props.on && "bg-sage-soft/70")}>
      <span className="w-9 shrink-0 text-xs font-semibold text-ink-soft">Set {props.k + 1}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        className={input}
        value={reps}
        placeholder={String(props.target.reps)}
        disabled={props.disabled}
        aria-label={`${props.name} set ${props.k + 1} ${props.target.timed ? "seconds" : "reps"}`}
        onChange={(e) => {
          setReps(e.target.value);
          commit(e.target.value, weight);
        }}
      />
      {props.weighted && (
        <>
          <span className="text-xs text-ink-faint">×</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            className={input}
            value={weight}
            placeholder={props.target.weight ? String(props.target.weight) : props.loggedUnit}
            disabled={props.disabled}
            aria-label={`${props.name} set ${props.k + 1} weight`}
            onChange={(e) => {
              setWeight(e.target.value);
              commit(reps, e.target.value);
            }}
          />
        </>
      )}
    </li>
  );
}

function History({ sessions, unit, timed }: { sessions: Session[]; unit: WeightUnit; timed: boolean }) {
  const shown = sessions.slice(0, 6);
  const maxes = sessions.map((s) => {
    const m = estimatedMax(s.sets);
    return m === null ? null : s.unit === unit ? m : s.unit === "kg" ? m * 2.20462 : m / 2.20462;
  });
  const newest = maxes[0];
  const oldestIdx = maxes.findLastIndex((m) => m !== null);
  const oldest = oldestIdx > 0 ? maxes[oldestIdx] : null;
  const change = newest != null && oldest != null ? Math.round(((newest - oldest) / oldest) * 100) : null;

  return (
    <div className="mt-1.5 flex flex-col gap-1">
      {change !== null && (
        <p className="font-semibold text-sage-ink">
          Estimated max {change >= 0 ? "up" : "down"} {Math.abs(change)}% since {monthDay(sessions[oldestIdx].date)}
        </p>
      )}
      <ul className="flex flex-col gap-0.5 text-ink-soft">
        {shown.map((s, i) => (
          <li key={`${s.date}-${i}`} className="flex justify-between gap-2">
            <span>{monthDay(s.date)}</span>
            <span className="font-mono">{formatSets(s.sets, s.unit, timed)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
