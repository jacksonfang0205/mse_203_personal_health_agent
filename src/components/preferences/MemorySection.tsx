"use client";

import { useState } from "react";
import { computeInsights } from "@/lib/insights";
import { WEEKDAY_LABELS } from "@/lib/labels";
import { WEEKDAYS, type BlockedTime, type Weekday } from "@/lib/schemas";
import { pivot, useNow, type AppState } from "@/lib/store";
import { dayLong, formatTime, monthDay } from "@/lib/time";
import { Button, Card, Chip, cx } from "../ui";
import { Field } from "./sections";

const INPUT = "rounded-2xl border border-line-strong bg-card px-4 py-2.5 text-sm focus:border-ink focus:outline-none";

function when(b: BlockedTime) {
  if (b.date) return `${dayLong(b.date)}, ${monthDay(b.date)} only`;
  if (b.days.length === 7) return "Every day";
  return b.days.map((d) => WEEKDAY_LABELS[d].short).join(", ");
}

/**
 * What Pivot remembers. Changes here save immediately (they aren't part of
 * the profile draft) and apply the next time Pivot plans.
 */
export function MemorySection({ state }: { state: AppState }) {
  const now = useNow();
  const [days, setDays] = useState<Weekday[]>([]);
  const [start, setStart] = useState("07:00");
  const [end, setEnd] = useState("09:00");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const insights = now ? computeInsights({ log: state.log, history: state.history, plan: state.plan, now }) : null;

  const addBlocked = () => {
    if (!days.length) return setError("Pick at least one day.");
    if (!start || !end || end <= start) return setError("End time must be after start time.");
    pivot.addBlocked([
      { id: crypto.randomUUID(), days, start, end, label: label.trim(), source: "user", createdAt: new Date().toISOString() },
    ]);
    setDays([]);
    setLabel("");
    setError(null);
  };

  const addNote = () => {
    const text = note.trim();
    if (!text) return;
    pivot.addNotes([{ id: crypto.randomUUID(), text: text.slice(0, 300), source: "user", createdAt: new Date().toISOString() }]);
    setNote("");
  };

  return (
    <Card className="p-6 sm:p-8">
      <h2 className="font-display text-2xl font-medium">Memory</h2>
      <p className="mt-1 mb-6 text-sm text-ink-soft">
        What Pivot remembers between weeks. Changes here save right away. Life Happens can suggest additions, and you approve
        each one.
      </p>

      <div className="flex flex-col gap-8">
        <Field label="Times I can't work out" hint="Pivot treats these like calendar events and never plans over them.">
          {state.blocked.length > 0 && (
            <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
              {state.blocked.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span>
                    <span className="font-semibold">{when(b)}</span> · {formatTime(b.start)}–{formatTime(b.end)}
                    {b.label && <span className="text-ink-soft"> · {b.label}</span>}
                    {b.source === "agent" && <span className="ml-2 text-xs text-ink-faint">(from Life Happens)</span>}
                  </span>
                  <button type="button" onClick={() => pivot.removeBlocked(b.id)} className="text-xs font-medium text-coral-deep hover:underline">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-3 rounded-2xl bg-paper-deep/50 p-4">
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => (
                <Chip
                  key={d}
                  selected={days.includes(d)}
                  onClick={() => setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d]))}
                  className="min-w-14 justify-center"
                >
                  {WEEKDAY_LABELS[d].short}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input type="time" aria-label="From" value={start} onChange={(e) => setStart(e.target.value)} className={INPUT} />
              <span className="text-sm text-ink-soft">to</span>
              <input type="time" aria-label="To" value={end} onChange={(e) => setEnd(e.target.value)} className={INPUT} />
              <input
                placeholder="Why (optional), e.g. commute"
                maxLength={80}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className={cx(INPUT, "min-w-48 flex-1")}
              />
              <Button variant="dark" className="h-10" onClick={addBlocked}>
                Add
              </Button>
            </div>
            {error && <p className="text-sm text-coral-deep">{error}</p>}
          </div>
        </Field>

        <Field label="Notes for Pivot" hint="Lasting preferences in your words, e.g. “I like a rest day after leg day.”">
          {state.notes.length > 0 && (
            <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
              {state.notes.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span>{n.text}</span>
                  <button type="button" onClick={() => pivot.removeNote(n.id)} className="shrink-0 text-xs font-medium text-coral-deep hover:underline">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addNote();
            }}
          >
            <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" className={cx(INPUT, "flex-1")} />
            <Button type="submit" variant="dark" className="h-10" disabled={!note.trim()}>
              Add
            </Button>
          </form>
        </Field>

        <Field label="What Pivot has learned" hint="From workouts you've marked done or skipped and the options you picked.">
          {insights && insights.summary.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {insights.summary.map((s) => (
                <li key={s}>• {s}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-faint">
              Not enough history yet. Mark workouts done or skipped on the week view and patterns will show up here.
            </p>
          )}
        </Field>
      </div>
    </Card>
  );
}
