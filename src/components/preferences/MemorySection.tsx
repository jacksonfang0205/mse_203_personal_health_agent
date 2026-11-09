"use client";

import { useState, type ReactNode } from "react";
import { computeInsights } from "@/lib/insights";
import { WEEKDAY_LABELS } from "@/lib/labels";
import { ALL_DAY, isAllDay } from "@/lib/memoryRules";
import { WEEKDAYS, type BlockedTime, type Weekday } from "@/lib/schemas";
import { pivot, useNow, type AppState } from "@/lib/store";
import { dayShort, formatTime, monthDay } from "@/lib/time";
import { Button, Chip, cx } from "../ui";

/**
 * What Pivot remembers, shown inside the basics card. Changes here save right
 * away (they aren't part of the profile draft). Life Happens can suggest
 * additions, and the user approves each one.
 */

const INPUT = "rounded-full border border-line-strong bg-card px-4 py-2 text-sm focus:border-ink focus:outline-none";

function describe(b: BlockedTime) {
  const when = b.date
    ? `${dayShort(b.date)} ${monthDay(b.date)} only`
    : b.days.length === 7
      ? "Every day"
      : b.days.map((d) => WEEKDAY_LABELS[d].short).join(", ");
  const hours = isAllDay(b) ? "all day" : `${formatTime(b.start)}–${formatTime(b.end)}`;
  return `${when} · ${hours}`;
}

export function Removable({ children, title, onRemove }: { children: ReactNode; title?: string; onRemove: () => void }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-paper-deep/60 py-1.5 pr-1.5 pl-3.5 text-sm"
    >
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        className="grid h-6 w-6 place-items-center rounded-full text-ink-faint hover:bg-ink/5 hover:text-ink"
      >
        ×
      </button>
    </span>
  );
}

/** Times the user can't work out. `onAdd` lets the page mirror whole days into its draft. */
export function BlockedEditor({ state, onAdd }: { state: AppState; onAdd?: (b: BlockedTime) => void }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<Weekday[]>([]);
  const [allDay, setAllDay] = useState(true);
  const [start, setStart] = useState("07:00");
  const [end, setEnd] = useState("09:00");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    if (!days.length) return setError("Pick at least one day.");
    const hours = allDay ? ALL_DAY : { start, end };
    if (hours.end <= hours.start) return setError("End time must be after start time.");
    const b: BlockedTime = {
      id: crypto.randomUUID(),
      days,
      ...hours,
      label: label.trim(),
      source: "user",
      createdAt: new Date().toISOString(),
    };
    pivot.addBlocked([b]);
    onAdd?.(b);
    setDays([]);
    setLabel("");
    setError(null);
    setOpen(false);
  };

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {state.blocked.map((b) => (
          <Removable
            key={b.id}
            title={b.source === "agent" ? "Saved from Life Happens" : undefined}
            onRemove={() => pivot.removeBlocked(b.id)}
          >
            <span>
              <span className="font-medium">{describe(b)}</span>
              {b.label && <span className="text-ink-soft"> · {b.label}</span>}
            </span>
          </Removable>
        ))}
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full border border-dashed border-line-strong px-3.5 py-1.5 text-sm font-medium text-ink-soft hover:border-ink/50 hover:text-ink"
          >
            + Add
          </button>
        )}
      </div>
      {open && (
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
            <Chip selected={allDay} onClick={() => setAllDay(true)}>
              All day
            </Chip>
            <Chip selected={!allDay} onClick={() => setAllDay(false)}>
              Some hours
            </Chip>
            {!allDay && (
              <>
                <input type="time" aria-label="From" value={start} onChange={(e) => setStart(e.target.value)} className={INPUT} />
                <span className="text-sm text-ink-soft">to</span>
                <input type="time" aria-label="To" value={end} onChange={(e) => setEnd(e.target.value)} className={INPUT} />
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              placeholder="Why (optional), e.g. lab"
              maxLength={80}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className={cx(INPUT, "min-w-48 flex-1")}
            />
            <Button variant="dark" className="h-10" onClick={add}>
              Save
            </Button>
            <Button variant="ghost" className="h-10" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          {error && <p className="text-sm text-coral-deep">{error}</p>}
        </div>
      )}
    </div>
  );
}

/** Lasting preferences in the user's words. */
export function NotesEditor({ state }: { state: AppState }) {
  const [note, setNote] = useState("");
  const add = () => {
    const text = note.trim();
    if (!text) return;
    pivot.addNotes([{ id: crypto.randomUUID(), text: text.slice(0, 300), source: "user", createdAt: new Date().toISOString() }]);
    setNote("");
  };
  return (
    <div className="flex w-full flex-col gap-2">
      {state.notes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {state.notes.map((n) => (
            <Removable key={n.id} onRemove={() => pivot.removeNote(n.id)}>
              {n.text}
            </Removable>
          ))}
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. I like a rest day after leg day"
          className={cx(INPUT, "flex-1")}
        />
        <Button type="submit" variant="dark" className="h-10" disabled={!note.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}

/** What past weeks show; empty when there isn't enough history yet. */
export function useLearned(state: AppState): string[] {
  const now = useNow();
  return now ? computeInsights({ log: state.log, history: state.history, plan: state.plan, now }).summary : [];
}
