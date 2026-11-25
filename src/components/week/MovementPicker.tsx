"use client";

import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { CATEGORY_STYLE, EQUIPMENT_LABELS, MUSCLE_LABELS } from "@/lib/labels";
import { avoidReasons, missingEquipment, searchMovements } from "@/lib/routine";
import {
  MUSCLE_GROUPS,
  WORKOUT_CATEGORIES,
  type Exercise,
  type FitnessProfile,
  type MuscleGroup,
  type WorkoutCategory,
} from "@/lib/schemas";
import { CategoryIcon, SkipIcon } from "../icons";
import { cx } from "../ui";
import { ExerciseVisual } from "./ExerciseVisual";

/**
 * Find a movement: a search bar, category and muscle filters, and a list of
 * matches with a picture. Movements that need equipment the user didn't list,
 * or that go against what they avoid, are labeled but can still be picked:
 * it's the user's routine.
 */
export function MovementPicker(props: {
  open: boolean;
  /** "Swap Goblet squat" or "Add a movement". */
  title: string;
  profile: FitnessProfile | null;
  /** Movements already in the workout, marked so they aren't added twice by accident. */
  current?: string[];
  /** Starting filter, e.g. the category of the movement being swapped. */
  initialCategory?: WorkoutCategory | "all";
  onPick: (ex: Exercise) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<WorkoutCategory | "all">("all");
  const [muscle, setMuscle] = useState<MuscleGroup | "all">("all");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) {
      setQuery("");
      setCategory(props.initialCategory ?? "all");
      setMuscle("all");
      d.showModal();
      search.current?.focus();
    }
    if (!props.open && d.open) d.close();
  }, [props.open, props.initialCategory]);

  const results = useMemo(
    () => searchMovements({ query, category, muscle }, props.profile),
    [query, category, muscle, props.profile],
  );

  // This dialog can sit on top of the workout dialog; keep its close from reaching that one.
  const stop = (e: SyntheticEvent) => e.stopPropagation();

  return (
    <dialog
      ref={ref}
      aria-label={props.title}
      onClose={(e) => {
        stop(e);
        props.onClose();
      }}
      onCancel={stop}
      onClick={(e) => {
        stop(e);
        if (e.target === ref.current) props.onClose();
      }}
      className="m-auto hidden h-[min(90dvh,48rem)] w-[min(100%-1.5rem,44rem)] flex-col overflow-hidden rounded-[var(--radius-card)] bg-card p-0 text-ink shadow-lift backdrop:bg-ink/40 open:flex"
    >
      {props.open && (
        <>
          <div className="flex flex-col gap-3 border-b border-line p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-2xl font-semibold">{props.title}</h2>
              <button type="button" onClick={props.onClose} aria-label="Close" className="rounded-full p-1.5 text-ink-soft hover:bg-ink/5">
                <SkipIcon />
              </button>
            </div>
            <label className="relative block">
              <span className="sr-only">Search movements</span>
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                width={18}
                height={18}
                className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-faint"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                ref={search}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search, e.g. squat, dumbbell, glutes"
                className="w-full rounded-full border border-line-strong bg-paper py-2.5 pr-4 pl-10 text-sm focus:border-ink focus:outline-none"
              />
            </label>
            <FilterRow label="Category">
              <Pill on={category === "all"} onClick={() => setCategory("all")}>
                All
              </Pill>
              {WORKOUT_CATEGORIES.map((c) => (
                <Pill key={c} on={category === c} onClick={() => setCategory(c)}>
                  <CategoryIcon category={c} width={13} height={13} />
                  {CATEGORY_STYLE[c].label}
                </Pill>
              ))}
            </FilterRow>
            <FilterRow label="Muscle">
              <Pill on={muscle === "all"} onClick={() => setMuscle("all")}>
                Any
              </Pill>
              {MUSCLE_GROUPS.map((m) => (
                <Pill key={m} on={muscle === m} onClick={() => setMuscle(m)}>
                  {MUSCLE_LABELS[m]}
                </Pill>
              ))}
            </FilterRow>
          </div>

          <div className="flex-1 overflow-y-auto p-3 sm:p-4">
            <p className="px-1 pb-2 text-xs text-ink-faint" aria-live="polite">
              {results.length} movement{results.length === 1 ? "" : "s"}
            </p>
            {results.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-ink-soft">
                <p>No movements match.</p>
                <button
                  type="button"
                  className="font-semibold text-coral-deep hover:underline"
                  onClick={() => {
                    setQuery("");
                    setCategory("all");
                    setMuscle("all");
                  }}
                >
                  Clear search and filters
                </button>
              </div>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {results.map((ex) => (
                  <li key={ex.id}>
                    <MovementOption
                      ex={ex}
                      profile={props.profile}
                      inWorkout={props.current?.includes(ex.id) ?? false}
                      onPick={() => props.onPick(ex)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}

function MovementOption({
  ex,
  profile,
  inWorkout,
  onPick,
}: {
  ex: Exercise;
  profile: FitnessProfile | null;
  inWorkout: boolean;
  onPick: () => void;
}) {
  const missing = profile ? missingEquipment(ex, profile) : [];
  const avoid = profile ? avoidReasons(ex, profile) : [];
  const style = CATEGORY_STYLE[ex.category];
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full items-center gap-3 rounded-2xl border border-line bg-card p-2 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-ink/40 hover:shadow-card"
    >
      <ExerciseVisual exerciseId={ex.id} className="w-24 shrink-0" sizes="96px" />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-semibold leading-snug">{ex.name}</span>
        <span className="text-xs text-ink-soft">
          <span className={cx("font-semibold", style.text)}>{style.label}</span> ·{" "}
          {ex.muscles
            .filter((m) => m !== "full_body")
            .map((m) => MUSCLE_LABELS[m])
            .join(", ") || "Full body"}
        </span>
        <span className="text-xs text-ink-faint">
          {ex.equipment.length ? ex.equipment.map((e) => EQUIPMENT_LABELS[e]).join(", ") : "No equipment"}
        </span>
        <span className="flex flex-wrap gap-1">
          {inWorkout && <Tag tone="ok">In this workout</Tag>}
          {missing.length > 0 && <Tag>Needs {missing.map((e) => EQUIPMENT_LABELS[e].toLowerCase()).join(", ")}</Tag>}
          {avoid.map((a) => (
            <Tag key={a} tone="warn">
              You avoid: {a.toLowerCase()}
            </Tag>
          ))}
        </span>
      </span>
    </button>
  );
}

function Tag({ tone = "muted", children }: { tone?: "muted" | "warn" | "ok"; children: React.ReactNode }) {
  return (
    <span
      className={cx(
        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
        tone === "warn" && "bg-coral-soft text-coral-ink",
        tone === "ok" && "bg-sage-soft text-sage-ink",
        tone === "muted" && "bg-paper-deep text-ink-soft",
      )}
    >
      {children}
    </span>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
      {children}
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
        on ? "border-ink bg-ink text-paper" : "border-line-strong bg-card text-ink-soft hover:border-ink/50 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
