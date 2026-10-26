"use client";

import { useRef, useState } from "react";
import type { DateRange } from "@/lib/calendar";
import { applyOperations, proposeRuleBasedAlternatives } from "@/lib/planner/alternatives";
import type { Alternative, BusyBlock, ClockTime, FitnessProfile, IsoDate, Proposal, WeeklyPlan } from "@/lib/schemas";
import { pivot } from "@/lib/store";
import { track } from "@/lib/telemetry";
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
}

export function LifeHappens({ plan, profile, busy, knownRange, now }: Props) {
  const [message, setMessage] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const openedAt = useRef<number | null>(null);

  const markOpened = () => {
    if (openedAt.current === null) {
      openedAt.current = Date.now();
      track("life_happens_opened");
    }
  };

  const submit = (text: string) => {
    markOpened();
    const userMessage = text.trim();
    if (!userMessage) return;
    const at = new Date();
    const p = proposeRuleBasedAlternatives({
      plan,
      profile,
      busy,
      knownRange,
      now,
      userMessage,
      proposalId: crypto.randomUUID(),
      createdAt: at.toISOString(),
    });
    setProposal(p);
    setDone(null);
    track("life_happens_submitted", { chars: userMessage.length, alternatives: p.alternatives.length });
  };

  const finish = (summary: string) => {
    setProposal(null);
    setMessage("");
    setDone(summary);
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
            Preview · AI in next milestone
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
          <Button type="submit" disabled={!message.trim()} className="h-12">
            Find options <ArrowRight />
          </Button>
        </form>

        {!proposal && (
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
              <MockBadge>Rule-based preview · not AI</MockBadge>
              <button type="button" onClick={() => setProposal(null)} className="text-sm text-ink-soft hover:text-ink">
                Close
              </button>
            </div>
            <ul className="flex flex-col gap-1 text-sm text-ink-soft">
              {proposal.understood.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
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
