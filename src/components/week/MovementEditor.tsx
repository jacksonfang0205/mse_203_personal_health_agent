"use client";

import { useState } from "react";
import { getExercise } from "@/lib/catalog";
import { defaultEntry } from "@/lib/routine";
import type { Exercise, FitnessProfile, WorkoutCategory, WorkoutExercise } from "@/lib/schemas";
import { cx } from "../ui";
import { ExerciseVisual } from "./ExerciseVisual";
import { MovementPicker } from "./MovementPicker";

/** A movement being edited. `from` is its place in the saved workout, or -1 when it's new. */
export interface EditItem {
  key: string;
  we: WorkoutExercise;
  from: number;
}

let keySeq = 0;
const newKey = () => `m${++keySeq}`;

export function toEditItems(exercises: WorkoutExercise[]): EditItem[] {
  return exercises.map((we, i) => ({ key: newKey(), we, from: i }));
}

/**
 * Edit a list of movements: swap any of them, remove, reorder, change sets
 * and reps, or add more from the movement picker.
 */
export function MovementEditor({
  items,
  onChange,
  profile,
}: {
  items: EditItem[];
  onChange: (items: EditItem[]) => void;
  profile: FitnessProfile | null;
}) {
  // Which slot the picker fills: an index to swap, or "add".
  const [picking, setPicking] = useState<number | "add" | null>(null);

  const swapping = typeof picking === "number" ? getExercise(items[picking]?.we.exerciseId ?? "") : undefined;
  const pick = (ex: Exercise) => {
    if (picking === "add") onChange([...items, { key: newKey(), we: defaultEntry(ex), from: -1 }]);
    else if (typeof picking === "number")
      onChange(items.map((it, i) => (i === picking ? { key: newKey(), we: defaultEntry(ex), from: it.from } : it)));
    setPicking(null);
  };
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const patch = (i: number, p: Partial<WorkoutExercise>) =>
    onChange(items.map((it, k) => (k === i ? { ...it, we: { ...it.we, ...p } } : it)));

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && (
        <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-soft">
          No movements yet. Add the first one.
        </p>
      )}
      <ol className="flex flex-col gap-2">
        {items.map((it, i) => {
          const ex = getExercise(it.we.exerciseId);
          return (
            <li key={it.key} className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <ExerciseVisual exerciseId={it.we.exerciseId} className="w-20 shrink-0" sizes="80px" />
                <div className="min-w-0">
                  <p className="font-semibold leading-snug">
                    <span className="mr-1.5 font-mono text-xs text-ink-faint">{i + 1}</span>
                    {ex?.name ?? it.we.exerciseId}
                  </p>
                  <Dose we={it.we} onChange={(p) => patch(i, p)} />
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <SmallButton onClick={() => move(i, -1)} disabled={i === 0} label={`Move ${ex?.name ?? "movement"} up`}>
                  ↑
                </SmallButton>
                <SmallButton
                  onClick={() => move(i, 1)}
                  disabled={i === items.length - 1}
                  label={`Move ${ex?.name ?? "movement"} down`}
                >
                  ↓
                </SmallButton>
                <SmallButton onClick={() => setPicking(i)} label={`Swap ${ex?.name ?? "movement"}`}>
                  Swap
                </SmallButton>
                <SmallButton
                  onClick={() => onChange(items.filter((_, k) => k !== i))}
                  label={`Remove ${ex?.name ?? "movement"}`}
                  tone="danger"
                >
                  Remove
                </SmallButton>
              </div>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={() => setPicking("add")}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-sm font-semibold text-ink-soft hover:border-ink/50 hover:text-ink"
      >
        <span aria-hidden className="text-lg leading-none">+</span> Add a movement
      </button>

      <MovementPicker
        open={picking !== null}
        title={swapping ? `Swap ${swapping.name}` : "Add a movement"}
        profile={profile}
        current={items.map((it) => it.we.exerciseId)}
        initialCategory={(swapping?.category as WorkoutCategory | undefined) ?? "all"}
        onPick={pick}
        onClose={() => setPicking(null)}
      />
    </div>
  );
}

const NUM = "w-14 rounded-lg border border-line-strong bg-paper px-2 py-1 text-center text-sm tabular-nums focus:border-ink focus:outline-none";

/** Sets × reps, sets × seconds, or minutes, depending on the movement. */
function Dose({ we, onChange }: { we: WorkoutExercise; onChange: (p: Partial<WorkoutExercise>) => void }) {
  const int = (v: string, max: number) => Math.max(1, Math.min(max, Math.round(Number(v)) || 1));
  if (we.minutes !== undefined) {
    return (
      <label className="mt-1 inline-flex items-center gap-1.5 text-xs text-ink-soft">
        <input aria-label="Minutes" type="number" min={1} max={120} className={NUM} value={we.minutes} onChange={(e) => onChange({ minutes: int(e.target.value, 120) })} />
        min
      </label>
    );
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
      <input aria-label="Sets" type="number" min={1} max={8} className={NUM} value={we.sets ?? 1} onChange={(e) => onChange({ sets: int(e.target.value, 8) })} />
      <span>sets ×</span>
      {we.seconds !== undefined ? (
        <>
          <input aria-label="Seconds" type="number" min={5} max={600} className={NUM} value={we.seconds} onChange={(e) => onChange({ seconds: int(e.target.value, 600) })} />
          <span>s</span>
        </>
      ) : (
        <>
          <input
            aria-label="Reps"
            className={cx(NUM, "w-24")}
            value={we.reps ?? ""}
            maxLength={20}
            onChange={(e) => onChange({ reps: e.target.value })}
            onBlur={(e) => !e.target.value.trim() && onChange({ reps: "10" })}
          />
          <span>reps</span>
        </>
      )}
    </div>
  );
}

function SmallButton({
  onClick,
  disabled,
  label,
  tone,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-full border px-3 text-xs font-semibold transition-colors disabled:opacity-30",
        tone === "danger"
          ? "border-line-strong text-ink-soft hover:border-coral hover:text-coral-deep"
          : "border-line-strong text-ink hover:border-ink/50",
      )}
    >
      {children}
    </button>
  );
}
