"use client";

import { useRef, useState } from "react";
import type { MemorySuggestions } from "@/lib/agent/lifeHappens";
import { isAllDay, rememberFromMessage } from "@/lib/memoryRules";
import { agentSnapshot, requestLifeHappens } from "@/lib/agentClient";
import type { DateRange } from "@/lib/calendar";
import { needsClarification, type Clarification, type ClarifyChoice } from "@/lib/coach/clarify";
import { describeSwaps, detectInjury, removeConflictingExercises, withInjury } from "@/lib/injuries";
import { applyOperations, proposeRuleBasedAlternatives } from "@/lib/planner/alternatives";
import type { Alternative, BusyBlock, ClockTime, FitnessProfile, IsoDate, Proposal, WeeklyPlan } from "@/lib/schemas";
import { pivot } from "@/lib/store";
import { track } from "@/lib/telemetry";
import { WEEKDAY_LABELS } from "@/lib/labels";
import { dayShort, formatTime, monthDay } from "@/lib/time";
import { validatePlan } from "@/lib/validation";
import { ArrowRight, Shield, Sparkle } from "../icons";
import { Button } from "../ui";

const stamp = () => Date.now();

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
  const hours = isAllDay(b) ? "all day" : `${formatTime(b.start)}–${formatTime(b.end)}`;
  return `Can't work out ${when} ${hours}${b.label ? ` (${b.label})` : ""}`;
}

export function LifeHappens({ plan, profile, busy, knownRange, now, ai }: Props) {
  const [message, setMessage] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [memory, setMemory] = useState<MemorySuggestions | null>(null);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [clarify, setClarify] = useState<{ message: string; c: Clarification } | null>(null);
  /** What the coach saved or swapped for an injury in this message. */
  const [injuryNote, setInjuryNote] = useState<string | null>(null);
  const openedAt = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const markOpened = () => {
    if (openedAt.current === null) {
      openedAt.current = stamp();
      track("life_happens_opened");
    }
  };

  // Read the store, not props: an injury saved in this same message changes the plan and profile.
  const ruleBased = (userMessage: string) =>
    proposeRuleBasedAlternatives({
      plan: pivot.get().plan ?? plan,
      profile: pivot.get().profile ?? profile,
      busy,
      knownRange,
      now,
      userMessage,
      proposalId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    });

  const ruleMemory = (userMessage: string): MemorySuggestions | null => {
    const blocked = rememberFromMessage(userMessage, pivot.get().blocked);
    return blocked.length ? { blocked, notes: [] } : null;
  };

  /**
   * An injury mentioned in chat is saved to Preferences (limitations + what
   * Pivot avoids), and conflicting exercises in upcoming workouts are swapped
   * out right away. Returns a line telling the user what happened.
   */
  const handleInjury = (userMessage: string): string | null => {
    const s = pivot.get();
    const injury = detectInjury(userMessage);
    if (!injury || !s.profile) return null;
    const nextProfile = { ...withInjury(s.profile, injury, now.date), updatedAt: new Date().toISOString() };
    pivot.saveProfile(nextProfile);
    const swapped = s.plan ? removeConflictingExercises(s.plan, nextProfile, now.date) : null;
    if (swapped?.swaps.length) pivot.setPlan(swapped.plan);
    track("injury_saved", { swaps: swapped?.swaps.length ?? 0 });
    return `Saved "${injury.label.toLowerCase()}" to your Preferences.${swapped?.swaps.length ? ` ${describeSwaps(swapped.swaps)}` : ""}`;
  };

  const submit = async (text: string, opts: { clarified?: boolean } = {}) => {
    markOpened();
    const userMessage = text.trim();
    if (!userMessage || loading) return;
    setMessage("");
    setDone(null);
    setNote(null);
    setMemory(null);
    setClarify(null);
    setUnchecked(new Set());
    const injury = handleInjury(userMessage);
    setInjuryNote(injury);
    // Ask before big changes: one short question, nothing changes until the user picks.
    const question = !opts.clarified && !injury ? needsClarification(userMessage, pivot.get().plan, now.date) : null;
    if (question) {
      setProposal(null);
      setClarify({ message: userMessage, c: question });
      track("coach_clarify_asked");
      return;
    }
    let p: Proposal;
    if (ai) {
      setProposal(null);
      setLoading(true);
      try {
        const res = await requestLifeHappens({ ...agentSnapshot(pivot.get(), now), message: userMessage, clarified: opts.clarified });
        if (res.clarify) {
          setClarify({ message: userMessage, c: res.clarify });
          return;
        }
        p = res.proposal;
        const blocked = res.memory.blocked.length ? res.memory.blocked : rememberFromMessage(userMessage, pivot.get().blocked);
        setMemory(blocked.length || res.memory.notes.length ? { ...res.memory, blocked } : null);
        setNote(res.fallback ?? null);
      } catch (e) {
        p = ruleBased(userMessage);
        setMemory(ruleMemory(userMessage));
        setNote(`Couldn't reach the AI (${(e as Error).message}), so these are simpler options.`);
      } finally {
        setLoading(false);
      }
    } else {
      p = ruleBased(userMessage);
      setMemory(ruleMemory(userMessage));
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

  const choose = (choice: ClarifyChoice) => {
    if (!clarify) return;
    track("coach_clarify_answered", { action: choice.action });
    if (choice.action === "send" && choice.message) {
      void submit(choice.message, { clarified: true });
    } else if (choice.action === "remember") {
      pivot.addNotes([{ id: crypto.randomUUID(), text: choice.message ?? clarify.message, source: "agent", createdAt: new Date().toISOString() }]);
      setClarify(null);
      setDone("Okay, your plan stays as it is. I'll remember that.");
    } else {
      setClarify(null);
      inputRef.current?.focus();
    }
  };

  const finish = (summary: string) => {
    const saved = saveMemory();
    setProposal(null);
    setMemory(null);
    setNote(null);
    setMessage("");
    setDone(saved ? `${summary} I'll remember that.` : summary);
    openedAt.current = null;
  };

  const accept = (alt: Alternative) => {
    if (!proposal) return;
    const current = pivot.get().plan ?? plan;
    const next = applyOperations(current, alt.operations);
    // Re-check at save time: nothing reaches storage without passing the gate. Locked preferences
    // only bend where this option said so and the user tapped OK on it.
    const check = validatePlan(next, {
      profile: pivot.get().profile ?? profile,
      busy,
      knownRange,
      now,
      previousPlan: current,
      lockPreferences: true,
      acceptedBends: alt.bends ?? [],
      dateLimits: proposal.dateLimits,
    });
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
      fit: alt.fit ?? null,
      msSinceOpen: msSince(openedAt.current),
    });
    finish(`Done. ${alt.summary}`);
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
    finish("Okay, your plan stays as it is.");
  };

  // The coach's reply: what it understood, or why nothing fits, in one or two short lines.
  // Rule-based options don't read the message, so they get a plain line instead of their internal note.
  const reply = proposal
    ? proposal.infeasibleReason ??
      (!proposal.alternatives.length
        ? "Nothing fits this week."
        : proposal.generatedBy === "agent"
          ? proposal.understood[0] ?? "Here's what we can do."
          : "Here are a few options for your next workout.")
    : null;

  return (
    <section aria-label="Coach" className="rounded-[var(--radius-card)] bg-ink p-5 text-paper shadow-lift sm:p-6">
      <div className="flex flex-col gap-4">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-coral">
          <Sparkle width={16} height={16} /> Coach
        </p>

        {clarify && (
          <div className="animate-rise flex flex-col gap-3">
            <p className="self-end rounded-2xl rounded-br-sm bg-paper/15 px-4 py-2.5 text-sm">{clarify.message}</p>
            <div className="flex flex-col gap-3 self-start rounded-2xl rounded-bl-sm bg-card p-4 text-ink sm:max-w-[85%]">
              {injuryNote && <p className="text-xs text-ink-soft">{injuryNote}</p>}
              <p className="text-sm">{clarify.c.question}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Quick replies">
                {clarify.c.choices.map((ch) => (
                  <button
                    key={ch.label}
                    type="button"
                    onClick={() => choose(ch)}
                    className="rounded-full border border-line-strong bg-paper px-3.5 py-1.5 text-xs font-semibold text-ink hover:border-ink/40"
                  >
                    {ch.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {proposal && (
          <div className="animate-rise flex flex-col gap-3">
            <p className="self-end rounded-2xl rounded-br-sm bg-paper/15 px-4 py-2.5 text-sm">{proposal.userMessage}</p>
            <div className="flex flex-col gap-3 self-start rounded-2xl rounded-bl-sm bg-card p-4 text-ink sm:max-w-[85%]">
              {injuryNote && <p className="text-xs text-ink-soft">{injuryNote}</p>}
              <p className="text-sm">{reply}</p>
              {note && <p className="text-xs text-ink-faint">{note}</p>}
              {proposal.alternatives.map((alt) => (
                <div key={alt.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper px-3.5 py-2.5">
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="text-sm font-semibold">{alt.title}</p>
                    <p className="text-xs text-ink-soft">{alt.summary}</p>
                    {alt.fit === "fits" ? (
                      <span className="inline-flex items-center gap-1 self-start rounded-full bg-sage-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sage-ink">
                        <Shield width={11} height={11} /> Fits your schedule
                      </span>
                    ) : alt.ask ? (
                      <p className="self-start rounded-lg bg-butter-soft px-2 py-1 text-xs font-medium text-butter-ink">{alt.ask}</p>
                    ) : null}
                  </div>
                  <Button variant="dark" className="h-9 shrink-0 px-4" onClick={() => accept(alt)}>
                    {alt.fit === "bends" ? "OK, use it" : "Use"}
                  </Button>
                </div>
              ))}
              {memory &&
                [
                  ...memory.blocked.map((b) => ({ id: b.id, text: describeBlocked(b) })),
                  ...memory.notes.map((n) => ({ id: n.id, text: n.text })),
                ].map((item) => (
                  <label key={item.id} className="flex items-start gap-2 text-xs text-ink-soft">
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
                    Remember: {item.text}
                  </label>
                ))}
              {proposal.alternatives.length > 0 ? (
                <button type="button" onClick={rejectAll} className="self-start text-xs text-ink-soft hover:text-ink">
                  Keep my plan
                </button>
              ) : (
                memory && (
                  <Button variant="dark" className="h-9 self-start" onClick={() => finish("Got it.")}>
                    Remember
                  </Button>
                )
              )}
            </div>
          </div>
        )}

        {loading && (
          <p role="status" className="animate-pulse self-start text-sm text-paper/70">
            Thinking…
          </p>
        )}

        {done && !proposal && !clarify && (
          <p role="status" className="self-start rounded-2xl rounded-bl-sm bg-paper/10 px-4 py-2.5 text-sm">
            {done}
          </p>
        )}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(message);
          }}
        >
          <label htmlFor="coach-input" className="sr-only">
            Message your coach
          </label>
          <input
            ref={inputRef}
            id="coach-input"
            value={message}
            onFocus={markOpened}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What changed?"
            className="h-12 flex-1 rounded-full border border-paper/15 bg-paper/10 px-5 text-paper placeholder:text-paper/45 focus:border-coral focus:outline-none"
          />
          <Button type="submit" disabled={!message.trim() || loading} className="h-12 w-12 px-0" aria-label="Send">
            <ArrowRight />
          </Button>
        </form>
      </div>
    </section>
  );
}
