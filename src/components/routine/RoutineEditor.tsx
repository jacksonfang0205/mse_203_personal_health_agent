"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { WEEKDAY_LABELS } from "@/lib/labels";
import { planFromRoutine, profileForRoutine, suggestTitle } from "@/lib/routine";
import { carryOver } from "@/lib/session";
import { Routine, WEEKDAYS, type ClockTime, type Weekday } from "@/lib/schemas";
import { pivot, usePivotState, type AppState } from "@/lib/store";
import { track } from "@/lib/telemetry";
import { localNow, planCovers, weekdayOf } from "@/lib/time";
import { Check } from "../icons";
import { Button, Card, Chip, Eyebrow, Skeleton, cx } from "../ui";
import { MovementEditor, toEditItems, type EditItem } from "../week/MovementEditor";

interface DayDraft {
  title: string;
  start: ClockTime;
  items: EditItem[];
}

const TEXT = "rounded-xl border border-line-strong bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none";

export function RoutineEditor() {
  const state = usePivotState();
  if (!state) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-12">
        <Skeleton className="h-96" />
      </div>
    );
  }
  return <Editor state={state} />;
}

/** Days from a saved routine, or else from this week's plan, so the user starts from what they see. */
function initialDays(state: AppState): Partial<Record<Weekday, DayDraft>> {
  const out: Partial<Record<Weekday, DayDraft>> = {};
  if (state.routine) {
    for (const d of state.routine.days) out[d.day] = { title: d.title, start: d.start, items: toEditItems(d.exercises) };
  }
  return out;
}

function Editor({ state }: { state: AppState }) {
  const router = useRouter();
  const [days, setDays] = useState(() => initialDays(state));
  const [name, setName] = useState(state.profile?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const firstTime = !state.profile;
  const chosen = WEEKDAYS.filter((d) => days[d]);

  const toggleDay = (d: Weekday) => {
    setError(null);
    setDays((cur) => {
      const next = { ...cur };
      if (next[d]) delete next[d];
      else next[d] = { title: "", start: "18:00", items: [] };
      return next;
    });
  };
  const patchDay = (d: Weekday, p: Partial<DayDraft>) => {
    setError(null);
    setDays((cur) => ({ ...cur, [d]: { ...cur[d]!, ...p } }));
  };

  const copyThisWeek = () => {
    const out: Partial<Record<Weekday, DayDraft>> = {};
    for (const w of state.plan?.workouts ?? []) {
      const d = weekdayOf(w.date);
      if (!out[d]) out[d] = { title: w.title, start: w.start, items: toEditItems(w.exercises) };
    }
    setDays(out);
  };

  const save = () => {
    if (!chosen.length) return setError("Pick at least one training day.");
    const empty = chosen.find((d) => !days[d]!.items.length);
    if (empty) return setError(`Add at least one movement to ${WEEKDAY_LABELS[empty].long}.`);
    const at = new Date();
    const parsed = Routine.safeParse({
      updatedAt: at.toISOString(),
      days: chosen.map((d) => {
        const day = days[d]!;
        const exercises = day.items.map((it) => (it.we.reps !== undefined && !it.we.reps.trim() ? { ...it.we, reps: "10" } : it.we));
        return { day: d, title: day.title.trim() || suggestTitle(exercises), start: day.start, exercises };
      }),
    });
    if (!parsed.success) return setError("Something doesn't look right. Check each day's time and movements.");
    const routine = parsed.data;
    const now = localNow(at);
    const weekStart = state.plan && planCovers(state.plan, now.date) ? state.plan.weekStart : now.date;
    const plan = planFromRoutine({ routine, weekStart, createdAt: at.toISOString(), keep: carryOver(state.plan, weekStart) });
    pivot.saveRoutine(routine, profileForRoutine(routine, state.profile, at.toISOString(), name), plan);
    track("routine_saved", { days: routine.days.length, movements: routine.days.reduce((n, d) => n + d.exercises.length, 0) });
    router.push("/week");
  };

  const stopUsingRoutine = () => {
    pivot.clearRoutine();
    router.push("/week");
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-10 sm:px-8">
      <header className="flex flex-col gap-2">
        <Eyebrow>Your routine</Eyebrow>
        <h1 className="font-display text-4xl font-medium tracking-tight">Already have a routine? Enter it once.</h1>
        <p className="text-ink-soft">
          Pick your training days and the movements you do on each. Pivot lays out every week from this, and you just log what
          you do. You can still change any single day&apos;s movements from My week.
        </p>
      </header>

      {firstTime && (
        <Card className="flex flex-col gap-2 p-5">
          <label className="flex flex-col gap-2">
            <span className="text-[15px] font-semibold">What should Pivot call you?</span>
            <input
              className={cx(TEXT, "max-w-sm")}
              placeholder="First name (optional)"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </Card>
      )}

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[15px] font-semibold">Which days do you train?</p>
          {!state.routine && state.plan && state.plan.workouts.length > 0 && (
            <button type="button" onClick={copyThisWeek} className="text-sm font-semibold text-coral-deep hover:underline">
              Start from this week&apos;s plan
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <Chip key={d} selected={!!days[d]} onClick={() => toggleDay(d)} className="min-w-14 justify-center">
              {WEEKDAY_LABELS[d].short}
            </Chip>
          ))}
        </div>
      </Card>

      {chosen.map((d) => {
        const day = days[d]!;
        const placeholder = day.items.length ? suggestTitle(day.items.map((it) => it.we)) : "e.g. Push day";
        return (
          <Card key={d} className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-end gap-3">
              <h2 className="mr-auto font-display text-2xl font-semibold">{WEEKDAY_LABELS[d].long}</h2>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink-faint">
                Name
                <input
                  className={cx(TEXT, "w-44 font-normal text-ink")}
                  placeholder={placeholder}
                  maxLength={60}
                  value={day.title}
                  onChange={(e) => patchDay(d, { title: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink-faint">
                Starts at
                <input
                  type="time"
                  className={cx(TEXT, "font-normal text-ink")}
                  value={day.start}
                  onChange={(e) => e.target.value && patchDay(d, { start: e.target.value as ClockTime })}
                />
              </label>
            </div>
            <MovementEditor items={day.items} onChange={(items) => patchDay(d, { items })} profile={state.profile} />
          </Card>
        );
      })}

      <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center gap-3 border-t border-line/70 bg-paper/95 px-5 py-4 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        <Button onClick={save}>
          <Check /> {state.routine ? "Save my routine" : "Use this routine"}
        </Button>
        {state.routine && (
          <Button variant="ghost" onClick={stopUsingRoutine}>
            Let Pivot plan instead
          </Button>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-coral-deep">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
