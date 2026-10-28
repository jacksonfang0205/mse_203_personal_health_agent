"use client";

import { useRef, useState } from "react";
import type { MemorySuggestions } from "@/lib/agent/lifeHappens";
import { agentSnapshot, requestLifeHappens } from "@/lib/agentClient";
import type { DateRange } from "@/lib/calendar";
import { applyOperations, proposeRuleBasedAlternatives } from "@/lib/planner/alternatives";
import type { Alternative, BusyBlock, ClockTime, FitnessProfile, IsoDate, Proposal, WeeklyPlan } from "@/lib/schemas";
import { pivot } from "@/lib/store";
import { track } from "@/lib/telemetry";
import { WEEKDAY_LABELS } from "@/lib/labels";
import { dayShort, formatTime, monthDay } from "@/lib/time";
import { validatePlan } from "@/lib/validation";
import { ArrowRight, Shield, Sparkle } from "../icons";
import { Button, MockBadge, cx } from "../ui";

const EXAMPLES = [
  "I have a midterm tomorrow and missed today's workout",
  "Only 20 minutes free on Friday",
  "My gym is closed this week, I just have bands",
  "A meeting got added Thursday evening",
];

const KIND_LABEL: Record<Alternative["kind"], string> = {
  shorter: "Shorter",
  move: "Reschedule",
  swap_format: "Different format",
  skip: "Rest",
};

function msSince(start: number | null) {
  return start === null ? null : Date.now() - start;
}

interface Props {
  plan: WeeklyPlan;
  profile: FitnessProfile;
  busy: BusyBlock[];
  knownRange: DateRange;
  now: { date: IsoDate; time: ClockTime };
  /** Live AI is configured on the server. */
  ai: boolean;
}

function describeBlocked(b: MemorySuggestions["blocked"][number]) {
  const when = b.date ? `${dayShort(b.date)} ${monthDay(b.date)} only,` : b.days.map((d) => WEEKDAY_LABELS[d].short).join(", ");
  return `Can't work out ${when} ${formatTime(b.start)}–${formatTime(b.end)}${b.label ? ` (${b.label})` : ""}`;
}

export function LifeHappens({ plan, profile, busy, knownRange, now, ai }: Props) {
  const [message, setMessage] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [memory, setMemory] = useState<MemorySuggestions | null>(null);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const openedAt = useRef<number | null>(null);

  const markOpened = () => {
    if (openedAt.current === null) {
      openedAt.current = Date.now();
      track("life_happens_opened");
    }
  };

  const ruleBased = (userMessage: string) =>
    proposeRuleBasedAlternatives({
      plan,
      profile,
      busy,
      knownRange,
      now,
      userMessage,
      proposalId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    });

  const submit = async (text: string) => {
    markOpened();
    const userMessage = text.trim();
    if (!userMessage || loading) return;
    setDone(null);
    setNote(null);
    setMemory(null);
    setUnchecked(new Set());
    let p: Proposal;
    if (ai) {
      setProposal(null);
      setLoading(true);
      try {
        const res = await requestLifeHappens({ ...agentSnapshot(pivot.get(), now), message: userMessage });
        p = res.proposal;
        setMemory(res.memory.blocked.length || res.memory.notes.length ? res.memory : null);
        setNote(res.fallback ?? null);
      } catch (e) {
        p = ruleBased(userMessage);
        setNote(`The AI couldn't answer (${(e as Error).message}). These are rule-based options.`);
      } finally {
        setLoading(false);
      }
    } else {
      p = ruleBased(userMessage);
    }
    setProposal(p);
    track("life_happens_submitted", { chars: userMessage.length, alternatives: p.alternatives.length, source: p.generatedBy });
  };

  /** Save the memory items the user left ticked. Returns how many were saved. */
  const saveMemory = () => {
    if (!memory) return 0;
    const blocked = memory.blocked.filter((b) => !unchecked.has(b.id));
    const notes = memory.notes.filter((n) => !unchecked.has(n.id));
    if (blocked.length) pivot.addBlocked(blocked);
    if (notes.length) pivot.addNotes(notes);
    return blocked.length + notes.length;
  };

  const finish = (summary: string) => {
    const saved = saveMemory();
    setProposal(null);
    setMemory(null);
    setNote(null);
    setMessage("");
    setDone(saved ? `${summary} Remembered ${saved} thing${saved > 1 ? "s" : ""} for next time.` : summary);
    openedAt.current = null;
  };

  const accept = (alt: Alternative) => {
    if (!proposal) return;
    const next = applyOperations(plan, alt.operations);
    // Re-check at save time: nothing reaches storage without passing the gate.
    const check = validatePlan(next, { profile, busy, knownRange, now, previousPlan: plan });
    if (!check.ok) {
      setDone(`Couldn't apply that option: ${check.violations[0]?.message}`);
      return;
    }
    pivot.setPlan(next);
    pivot.recordChange({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      userMessage: proposal.userMessage,
      proposalId: proposal.id,
      decision: "accepted",
      alternativeId: alt.id,
      alternativeKind: alt.kind,
      summary: alt.summary,
      offeredKinds: proposal.alternatives.map((a) => a.kind),
    });
    track("alternative_accepted", {
      kind: alt.kind,
      msSinceOpen: msSince(openedAt.current),
    });
    finish(`Updated: ${alt.summary}`);
  };

  const rejectAll = () => {
    if (!proposal) return;
    pivot.recordChange({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      userMessage: proposal.userMessage,
      proposalId: proposal.id,
      decision: "rejected",
      summary: "None of the options worked.",
      offeredKinds: proposal.alternatives.map((a) => a.kind),
    });
    track("alternatives_rejected", { offered: proposal.alternatives.length });
    finish("No changes made. Your plan stays as it was.");
  };

  return (
    <section
      aria-labelledby="life-happens-title"
      className="relative overflow-hidden rounded-[var(--radius-card)] bg-ink p-6 text-paper shadow-lift sm:p-8"
    >
      <div aria-hidden className="pointer-events-none absolute -top-20 -right-16 h-64 w-64 rounded-full bg-coral/30 blur-3xl" />
      <div className="relative flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="mb-1 inline-flex items-center gap-1.5 text-sm font-semibold text-coral">
              <Sparkle width={16} height={16} /> Life Happens
            </p>
            <h2 id="life-happens-title" className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
              Plans changed? Pivot with them.
            </h2>
          </div>
          <span className="rounded-full border border-paper/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-paper/70">
            {ai ? "Live AI · every option checked" : "Preview · AI not configured"}
          </span>
        </div>

        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            submit(message);
          }}
        >
          <label htmlFor="life-happens-input" className="sr-only">
            What changed?
          </label>
          <input
            id="life-happens-input"
            value={message}
            onFocus={markOpened}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What changed this week?"
            className="h-12 flex-1 rounded-full border border-paper/15 bg-paper/10 px-5 text-paper placeholder:text-paper/45 focus:border-coral focus:outline-none"
          />
          <Button type="submit" disabled={!message.trim() || loading} className="h-12">
            {loading ? "Thinking…" : "Find options"} <ArrowRight />
          </Button>
        </form>

        {loading && (
          <p role="status" className="animate-pulse rounded-2xl bg-paper/10 px-4 py-3 text-sm text-paper/80">
            Reading your week and checking options against your calendar…
          </p>
        )}

        {!proposal && !loading && (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setMessage(ex);
                  submit(ex);
                }}
                className="rounded-full border border-paper/15 px-3.5 py-1.5 text-xs text-paper/75 transition hover:border-paper/40 hover:text-paper"
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        {done && (
          <p role="status" className="animate-rise rounded-2xl bg-paper/10 px-4 py-3 text-sm text-paper">
            {done}
          </p>
        )}

        {proposal && (
          <div className="animate-rise flex flex-col gap-4 rounded-2xl bg-card p-5 text-ink sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {proposal.generatedBy === "agent" && !note ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-lilac-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-lilac-ink">
                  <Sparkle width={13} height={13} /> AI options
                </span>
              ) : (
                <MockBadge>Rule-based preview · not AI</MockBadge>
              )}
              <button type="button" onClick={() => setProposal(null)} className="text-sm text-ink-soft hover:text-ink">
                Close
              </button>
            </div>
            <ul className="flex flex-col gap-1 text-sm text-ink-soft">
              {proposal.understood.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
            {note && <p className="text-xs text-ink-faint">{note}</p>}
            {proposal.infeasibleReason && <p className="text-sm font-medium">{proposal.infeasibleReason}</p>}

            <div className="grid gap-3 md:grid-cols-3">
              {proposal.alternatives.map((alt, i) => (
                <article
                  key={alt.id}
                  style={{ animationDelay: `${i * 70}ms` }}
                  className="animate-rise flex flex-col gap-3 rounded-2xl border border-line bg-paper p-4"
                >
                  <span
                    className={cx(
                      "self-start rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                      alt.kind === "skip" ? "bg-ink/10 text-ink-soft" : "bg-coral-soft text-coral-ink",
                    )}
                  >
                    {KIND_LABEL[alt.kind]}
                  </span>
                  <h3 className="font-display text-lg leading-snug font-semibold">{alt.title}</h3>
                  <p className="text-sm">{alt.summary}</p>
                  <ul className="flex flex-col gap-1 text-xs text-ink-soft">
                    {alt.tradeoffs.map((t) => (
                      <li key={t}>• {t}</li>
                    ))}
                  </ul>
                  <p className="mt-auto inline-flex items-center gap-1 text-[11px] font-semibold text-sage-ink">
                    <Shield width={14} height={14} /> Passes all schedule checks
                  </p>
                  <Button variant="dark" className="h-10" onClick={() => accept(alt)}>
                    Use this
                  </Button>
                </article>
              ))}
            </div>
            {memory && (
              <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-line-strong p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Remember for next time?</p>
                {[
                  ...memory.blocked.map((b) => ({ id: b.id, text: describeBlocked(b) })),
                  ...memory.notes.map((n) => ({ id: n.id, text: n.text })),
                ].map((item) => (
                  <label key={item.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-coral"
                      checked={!unchecked.has(item.id)}
                      onChange={(e) =>
                        setUnchecked((u) => {
                          const next = new Set(u);
                          if (e.target.checked) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        })
                      }
                    />
                    {item.text}
                  </label>
                ))}
                <p className="text-xs text-ink-faint">Saved when you pick an option. You can edit memory in Preferences.</p>
                {proposal.alternatives.length === 0 && (
                  <Button variant="dark" className="h-9 self-start" onClick={() => finish("No changes to your plan.")}>
                    Save to memory
                  </Button>
                )}
              </div>
            )}
            {proposal.alternatives.length > 0 && (
              <button type="button" onClick={rejectAll} className="self-start text-sm font-medium text-ink-soft underline-offset-4 hover:underline">
                None of these work
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
