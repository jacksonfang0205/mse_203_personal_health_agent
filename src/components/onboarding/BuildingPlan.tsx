"use client";

import { useEffect, useRef, useState } from "react";
import { Check, PivotMark } from "../icons";
import { cx } from "../ui";

export interface BuildStep {
  label: string;
  detail: string;
}

/** Time each step stays "in progress" before it ticks off. The whole screen lasts about 3 seconds. */
const STEP_MS = 750;

/**
 * A short "building your plan" moment between onboarding and the week. The plan is
 * already built when this shows; each line names real work the planner did, with
 * numbers from the user's own answers, so it reads as Pivot thinking, not a spinner.
 */
export function BuildingPlan({ name, steps, onDone }: { name?: string; steps: BuildStep[]; onDone: () => void }) {
  const [done, setDone] = useState(0);
  const finish = useRef(onDone);
  useEffect(() => {
    finish.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const last = done >= steps.length;
    const t = setTimeout(() => (last ? finish.current() : setDone((d) => d + 1)), last ? 500 : STEP_MS);
    return () => clearTimeout(t);
  }, [done, steps.length]);

  return (
    <div className="grid min-h-dvh place-items-center bg-ink px-5 text-paper" aria-live="polite" aria-busy={done < steps.length}>
      <div className="w-full max-w-md animate-rise">
        <PivotMark width={34} height={34} className="mb-6 animate-pulse text-coral" />
        <h1 className="font-display text-4xl leading-tight font-medium tracking-tight">
          Building your week{name ? `, ${name}` : ""}…
        </h1>
        <ol className="mt-8 flex flex-col gap-4">
          {steps.map((s, i) => {
            const state = i < done ? "done" : i === done ? "active" : "todo";
            return (
              <li
                key={s.label}
                className={cx("flex items-start gap-3 transition-opacity duration-300", state === "todo" && "opacity-30")}
              >
                <span
                  className={cx(
                    "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-colors",
                    state === "done" ? "border-coral bg-coral text-white" : "border-paper/40",
                  )}
                >
                  {state === "done" ? (
                    <Check width={14} height={14} />
                  ) : state === "active" ? (
                    <span className="h-2 w-2 animate-ping rounded-full bg-coral" />
                  ) : null}
                </span>
                <div>
                  <p className="font-semibold">{s.label}</p>
                  <p className="text-sm text-paper/60">{s.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
