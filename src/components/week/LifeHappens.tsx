"use client";

import { useEffect, useRef, useState } from "react";
import type { MemorySuggestions } from "@/lib/agent/lifeHappens";
import { isAllDay, rememberFromMessage } from "@/lib/memoryRules";
import { agentSnapshot, requestLifeHappens } from "@/lib/agentClient";
import type { DateRange } from "@/lib/calendar";
import {
  buildPreferenceChange,
  needsClarification,
  nextQuestion,
  outOfScopeChanges,
  type ClarifyAnswers,
  type ClarifyChoice,
  type ClarifyQuestion,
  type PreferenceRequest,
} from "@/lib/coach/clarify";
import { stillActionable, unsavedMemory } from "@/lib/coach/history";
import { describeSwaps, detectInjury, injuryMemoryNote, removeConflictingExercises, withInjury } from "@/lib/injuries";
import { finalizeAlternative } from "@/lib/planner/describe";
import { getExercise } from "@/lib/catalog";
import { applyOperations, proposeRuleBasedAlternatives } from "@/lib/planner/alternatives";
import type { Alternative, BodyFocus, BusyBlock, ClockTime, FitnessProfile, IsoDate, PlanOperation, Proposal, WeeklyPlan } from "@/lib/schemas";
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

/** A short title for a preference change, from what it actually does. */
function preferenceTitle(req: PreferenceRequest, answers: ClarifyAnswers, ops: PlanOperation[]): string {
  const n = ops.length;
  const region = req.region === "lower" ? "lower-body" : "upper-body";
  if (req.kind === "shift") return `Shift ${n} day${n > 1 ? "s" : ""} to ${region} ${answers.style ?? req.emphasis}`;
  if (answers.how === "swap") return `Swap ${region} strength for mobility`;
  if (answers.how === "day") return `Make one day ${region} ${req.emphasis}`;
  return req.emphasis === "mobility" ? `Add ${region} mobility to ${n} day${n > 1 ? "s" : ""}` : `Add ${region} moves to ${n} day${n > 1 ? "s" : ""}`;
}

/** "Out: Goblet squat. In: Hip circles, …" for each changed workout. */
function exerciseDiff(plan: WeeklyPlan, ops: PlanOperation[]): string[] {
  return ops.flatMap((op) => {
    if (op.op !== "replace") return [];
    const before = plan.workouts.find((w) => w.id === op.workoutId);
    if (!before) return [];
    const name = (id: string) => getExercise(id)?.name ?? id;
    const out = before.exercises.filter((e) => !op.workout.exercises.some((x) => x.exerciseId === e.exerciseId)).map((e) => name(e.exerciseId));
    const inn = op.workout.exercises.filter((e) => !before.exercises.some((x) => x.exerciseId === e.exerciseId)).map((e) => name(e.exerciseId));
    return [`${before.title}: ${out.length ? `out ${out.join(", ")}; ` : ""}in ${inn.join(", ") || "nothing"}. Same time and length.`];
  });
}

export function LifeHappens({ plan, profile, busy, knownRange, now, ai }: Props) {
  const [message, setMessage] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [memory, setMemory] = useState<MemorySuggestions | null>(null);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  /** A multi-step clarifying conversation: the request, what's been asked and answered, and the next question. */
  const [clarify, setClarify] = useState<{
    message: string;
    request: PreferenceRequest;
    answers: ClarifyAnswers;
    asked: { q: string; a: string }[];
    next: ClarifyQuestion | null;
  } | null>(null);
  /** For an option built from a preference request: the only workouts it may touch. */
  const [scope, setScope] = useState<string[] | null>(null);
  // A confirmation of something already applied doesn't linger in the coach box.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 8000);
    return () => clearTimeout(t);
  }, [done]);
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
    // Also into the coach's memory (Notes for Pivot), which every later coach turn and re-plan reads.
    const memoryNote = injuryMemoryNote(injury, s.notes, now.date);
    if (memoryNote) pivot.addNotes([memoryNote]);
    const swapped = s.plan ? removeConflictingExercises(s.plan, nextProfile, now.date) : null;
    if (swapped?.swaps.length) pivot.setPlan(swapped.plan);
    track("injury_saved", { swaps: swapped?.swaps.length ?? 0 });
    return `Saved "${injury.label.toLowerCase()}" to your Preferences and my memory.${swapped?.swaps.length ? ` ${describeSwaps(swapped.swaps)}` : ""}`;
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
    setScope(null);
    setUnchecked(new Set());
    const injury = handleInjury(userMessage);
    setInjuryNote(injury);
    // Ask before big changes: a few short questions, one at a time; nothing changes until they're answered.
    const flow = !opts.clarified && !injury ? needsClarification(userMessage, pivot.get().plan, now.date) : null;
    if (flow) {
      setProposal(null);
      track("coach_clarify_asked");
      if (flow.next) setClarify({ message: userMessage, request: flow.request, answers: {}, asked: [], next: flow.next });
      else completeFlow(userMessage, flow.request, {});
      return;
    }
    let p: Proposal;
    if (ai) {
      setProposal(null);
      setLoading(true);
      try {
        const res = await requestLifeHappens({ ...agentSnapshot(pivot.get(), now), message: userMessage, clarified: opts.clarified });
        if (res.clarify) {
          if (res.clarify.next) setClarify({ message: userMessage, request: res.clarify.request, answers: {}, asked: [], next: res.clarify.next });
          else completeFlow(userMessage, res.clarify.request, {});
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
    const fresh = unsavedMemory(memory, { blocked: pivot.get().blocked, notes: pivot.get().notes });
    if (!fresh) return 0;
    const blocked = fresh.blocked.filter((b) => !unchecked.has(b.id));
    const notes = fresh.notes.filter((n) => !unchecked.has(n.id));
    if (blocked.length) pivot.addBlocked(blocked);
    if (notes.length) pivot.addNotes(notes);
    return blocked.length + notes.length;
  };

  /**
   * Save the stated preference so future plans and the coach follow it. It lives in the profile's
   * body focus, shown (and removable) under "Notes for Pivot", so it isn't duplicated as a note.
   */
  const rememberPreference = (bodyFocus: BodyFocus) => {
    const s = pivot.get();
    if (s.profile) pivot.saveProfile({ ...s.profile, bodyFocus: { ...s.profile.bodyFocus, ...bodyFocus }, updatedAt: new Date().toISOString() });
  };

  /** All questions answered (or skipped): build the smallest change in code and offer it. */
  const completeFlow = (userMessage: string, request: PreferenceRequest, answers: ClarifyAnswers) => {
    const s = pivot.get();
    const current = s.plan ?? plan;
    const change = buildPreferenceChange(request, answers, current, s.profile ?? profile, now.date);
    rememberPreference(change.bodyFocus);
    setClarify(null);
    if (!change.operations.length) {
      setDone(`${change.note ?? "Okay."} Saved to your preferences: ${change.memory}`);
      return;
    }
    const alt = finalizeAlternative(
      current,
      {
        id: `${crypto.randomUUID()}-pref`,
        kind: "swap_format",
        title: preferenceTitle(request, answers, change.operations),
        summary: "",
        tradeoffs: exerciseDiff(current, change.operations),
        operations: change.operations,
      },
      { profile: s.profile ?? profile, busy, knownRange, now, previousPlan: current },
    );
    setScope(change.scope);
    setProposal({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      userMessage,
      understood: [`Here's the smallest change that does that. Everything else stays as it is. Saved to your preferences: ${change.memory}`],
      alternatives: alt ? [alt] : [],
      infeasibleReason: alt ? undefined : "That change wouldn't fit your schedule rules, so I've only saved the preference.",
      generatedBy: "agent",
    });
  };

  const choose = (choice: ClarifyChoice | "skip") => {
    if (!clarify?.next) return;
    const q = clarify.next;
    const value = choice === "skip" ? q.fallback : choice.value;
    const label = choice === "skip" ? `Skip (${q.choices.find((c) => c.value === q.fallback)?.label ?? "default"})` : choice.label;
    track("coach_clarify_answered", { question: q.id, skipped: choice === "skip" });
    const answers = { ...clarify.answers, [q.id]: value };
    const asked = [...clarify.asked, { q: q.text, a: label }];
    const next = nextQuestion(clarify.request, answers, pivot.get().plan ?? plan, now.date);
    if (next) setClarify({ ...clarify, answers, asked, next });
    else completeFlow(clarify.message, clarify.request, answers);
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
    // A preference-level change may only touch the days it was scoped to.
    const outside = scope ? outOfScopeChanges(current, next, scope) : [];
    if (outside.length) {
      setDone(`Couldn't apply that: it would also change ${outside.map((w) => w.title).join(", ")}.`);
      return;
    }
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

  // Done items drop out of the coach box: options for workouts already completed, skipped or past,
  // and "Remember:" suggestions already saved.
  const shown = proposal ? proposal.alternatives.filter((a) => stillActionable(a, plan, now.date)) : [];
  const hiddenDone = proposal ? proposal.alternatives.length - shown.length : 0;
  const state = pivot.get();
  const memoryShown = unsavedMemory(memory, { blocked: state.blocked, notes: state.notes });

  // The coach's reply: what it understood, or why nothing fits, in one or two short lines.
  // Rule-based options don't read the message, so they get a plain line instead of their internal note.
  const reply = proposal
    ? proposal.infeasibleReason ??
      (!shown.length && hiddenDone
        ? "That workout is already done, so I've cleared those options."
        : !proposal.alternatives.length
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
            {clarify.asked.map((t, i) => (
              <div key={i} className="flex flex-col gap-2">
                <p className="self-start rounded-2xl rounded-bl-sm bg-paper/10 px-4 py-2 text-sm text-paper/80">{t.q}</p>
                <p className="self-end rounded-2xl rounded-br-sm bg-paper/15 px-4 py-2 text-sm">{t.a}</p>
              </div>
            ))}
            {clarify.next && (
              <div className="flex flex-col gap-3 self-start rounded-2xl rounded-bl-sm bg-card p-4 text-ink sm:max-w-[85%]">
                {injuryNote && <p className="text-xs text-ink-soft">{injuryNote}</p>}
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                  Question {clarify.asked.length + 1} · nothing changes until you answer
                </p>
                <p className="text-sm">{clarify.next.text}</p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Quick replies">
                  {clarify.next.choices.map((ch) => (
                    <button
                      key={ch.value}
                      type="button"
                      onClick={() => choose(ch)}
                      className="rounded-full border border-line-strong bg-paper px-3.5 py-1.5 text-xs font-semibold text-ink hover:border-ink/40"
                    >
                      {ch.label}
                    </button>
                  ))}
                  <button type="button" onClick={() => choose("skip")} className="px-2 text-xs text-ink-soft hover:text-ink">
                    Skip
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {proposal && (
          <div className="animate-rise flex flex-col gap-3">
            <p className="self-end rounded-2xl rounded-br-sm bg-paper/15 px-4 py-2.5 text-sm">{proposal.userMessage}</p>
            <div className="flex flex-col gap-3 self-start rounded-2xl rounded-bl-sm bg-card p-4 text-ink sm:max-w-[85%]">
              {injuryNote && <p className="text-xs text-ink-soft">{injuryNote}</p>}
              <p className="text-sm">{reply}</p>
              {note && <p className="text-xs text-ink-faint">{note}</p>}
              {shown.map((alt) => (
                <div key={alt.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper px-3.5 py-2.5">
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="text-sm font-semibold">{alt.title}</p>
                    <p className="text-xs text-ink-soft">{alt.summary}</p>
                    {alt.id.endsWith("-pref") && alt.tradeoffs.map((t) => <p key={t} className="text-xs text-ink-faint">{t}</p>)}
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
              {memoryShown &&
                [
                  ...memoryShown.blocked.map((b) => ({ id: b.id, text: describeBlocked(b) })),
                  ...memoryShown.notes.map((n) => ({ id: n.id, text: n.text })),
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
              {shown.length > 0 ? (
                <button type="button" onClick={rejectAll} className="self-start text-xs text-ink-soft hover:text-ink">
                  Keep my plan
                </button>
              ) : (
                memoryShown && (
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
