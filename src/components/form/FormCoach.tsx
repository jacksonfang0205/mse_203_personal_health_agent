"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAiStatus } from "@/lib/agentClient";
import type { TraceStep } from "@/lib/agent/loop";
import { extractPose, preloadPoseModel, type ExtractResult } from "@/lib/form/browserPose";
import type { FormChatResponse, FormCoachRequest, FormCoachResponse } from "@/lib/form/coach";
import { detectMovement, type MovementGuess } from "@/lib/form/detect";
import { loadFormHistory, parseSetNote, saveFormSession } from "@/lib/form/formHistory";
import { MOVEMENTS } from "@/lib/form/movements";
import type { FitnessProfile } from "@/lib/schemas";
import { usePivotState, useNow } from "@/lib/store";
import { ArrowRight, Shield, Sparkle } from "../icons";
import { Button, Chip, cx } from "../ui";
import { FeedbackCard } from "./FeedbackCard";

type Stage = "upload" | "movement" | "waiting" | "confirm" | "context" | "reviewing" | "chat";

type Msg =
  | { id: number; from: "coach" | "user"; kind: "text"; text: string; tone?: "safety" | "muted" }
  | { id: number; from: "user"; kind: "video"; url: string; name: string }
  | { id: number; from: "coach"; kind: "progress" }
  | { id: number; from: "coach"; kind: "trace"; trace: TraceStep[] | null; generatedBy?: FormCoachResponse["generatedBy"] }
  | { id: number; from: "coach"; kind: "result"; result: FormCoachResponse };

type DistOmit<T> = T extends unknown ? Omit<T, "id"> : never;
type MsgInput = DistOmit<Msg>;

const MOVEMENT_CHOICES = [
  { id: "squat", label: "Squat" },
  { id: "hinge", label: "Hinge / RDL" },
  { id: "push_up", label: "Push-up" },
  { id: "lunge", label: "Lunge / split squat" },
];

const STEP_LABELS: Record<string, (movement: string) => string> = {
  get_movement_guide: (m) => `Read the ${m.toLowerCase()} guide`,
  get_rep_metrics: () => "Measured every rep",
  get_measured_faults: () => "Checked each rep against the fault rules",
  compare_to_golden: () => "Compared you with the good-form examples",
  get_history_signals: () => "Looked at this set's load and your past sessions",
  find_fixes: () => "Found fixes that fit your equipment",
  submit_coaching: () => "Wrote your feedback",
  reply: () => "Wrote a reply",
};

const PENDING_STEPS = ["Measuring every rep", "Reading the movement guide", "Comparing with good-form examples", "Checking your history", "Picking the most useful fix"];

/** Used when the user hasn't done onboarding: a common home-gym setup. */
const DEFAULT_PROFILE: FitnessProfile = {
  version: 1,
  goals: ["general_fitness"],
  targetMuscles: [],
  experience: "intermediate",
  workoutTypes: ["gym", "home"],
  equipment: ["dumbbells", "bench", "resistance_bands", "yoga_mat"],
  sessionMinutes: 45,
  frequencyPerWeek: 3,
  preferredDays: ["mon", "wed", "fri"],
  preferredTimes: ["evening"],
  avoidTags: [],
  avoidExerciseIds: [],
  avoidNotes: "",
  limitations: "",
  updatedAt: "2026-01-01T00:00:00Z",
};

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

function feedbackText(r: FormCoachResponse): string {
  const f = r.feedback;
  return [
    f.headline,
    ...f.findings.map((x) => `${x.label} on reps ${x.reps.join(", ")}; likely cause: ${x.cause?.label ?? "unclear"} (${x.evidence})`),
    ...f.cues.map((c) => `Cue: ${c}`),
    ...f.changes.map((c) => `Change: ${c.kind}${c.exerciseName ? ` ${c.exerciseName}` : ""}${c.drillName ? ` ${c.drillName}` : ""}${c.loadChangePct ? ` ${c.loadChangePct}%` : ""} (${c.reason})`),
    f.retest ? `Retest: ${f.retest}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function FormCoach() {
  const state = usePivotState();
  const now = useNow();
  const ai = useAiStatus();
  const profile = state?.profile ?? DEFAULT_PROFILE;

  const nextId = useRef(1);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [stage, setStage] = useState<Stage>("upload");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ stage: "model" | "tracking"; fraction: number } | null>(null);
  const [extracted, setExtracted] = useState<ExtractResult | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const choiceRef = useRef<string | null>(null);
  const extractedRef = useRef<ExtractResult | null>(null);
  const [movementId, setMovementId] = useState<string | null>(null);
  const [guess, setGuess] = useState<MovementGuess | null>(null);
  const [input, setInput] = useState("");
  const [lastRequest, setLastRequest] = useState<FormCoachRequest | null>(null);
  const [result, setResult] = useState<FormCoachResponse | null>(null);
  const [chat, setChat] = useState<{ role: "user" | "coach"; content: string }[]>([]);
  const [followups, setFollowups] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** Adds messages and returns the id of the first one. Ids are assigned here, not inside the state updater. */
  const push = (m: MsgInput | MsgInput[]) => {
    const items = (Array.isArray(m) ? m : [m]).map((x) => ({ ...x, id: nextId.current++ }) as Msg);
    setMsgs((xs) => [...xs, ...items]);
    return items[0].id;
  };
  const coach = (text: string, tone?: "safety" | "muted") => push({ from: "coach", kind: "text", text, tone });

  // Greeting. Runs once on mount.
  const greeted = useRef(false);
  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;
    preloadPoseModel();
    push([
      { from: "coach", kind: "text", text: pick(["Hey, I'm your form coach.", "Hi! Let's look at your form.", "Hey there. Ready when you are."]) + " Send me a clip of one set and I'll go through it rep by rep." },
      {
        from: "coach",
        kind: "text",
        tone: "muted",
        text: "Filming tips: phone at hip height, 2–3 m away, whole body in frame including your feet. Film from the side to check depth and lean, or from the front to check whether your knees cave in. One set, under 90 seconds. The video stays on your device; only the joint positions are sent.",
      },
    ]);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, stage, thinking]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function askContext() {
    coach(
      pick([
        "Anything I should know about this set? The weight, how hard it felt, or anything that hurt.",
        "Quick one before I review: what weight was that, and how did it feel?",
        "Tell me a bit about the set if you like: load, effort, anything that felt off.",
      ]),
    );
    setStage("context");
  }

  /** Tracking is done and we know what the user picked: confirm a detected movement or go on. */
  function proceed(ex: ExtractResult, ch: string) {
    if (ch === "detect") {
      const g = detectMovement(ex.pose);
      setGuess(g);
      if (g.movementId) {
        const name = MOVEMENTS[g.movementId].name.toLowerCase();
        coach(`${g.confidence === "low" ? "My best guess is" : "Looks like"} a ${name}${g.reps ? `, ${g.reps} reps` : ""}. ${g.reason} Is that right?`);
      } else coach(`${g.reason} Which movement is it?`);
      setStage("confirm");
    } else {
      setMovementId(ch);
      askContext();
    }
  }

  async function onFile(file: File) {
    if (!file.type.startsWith("video/")) {
      coach("That doesn't look like a video. Try an .mp4 or .mov clip.");
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setExtracted(null);
    extractedRef.current = null;
    setExtractError(null);
    choiceRef.current = null;
    setMovementId(null);
    setResult(null);
    setChat([]);
    push([
      { from: "user", kind: "video", url, name: file.name },
      { from: "coach", kind: "progress" },
      { from: "coach", kind: "text", text: pick(["Got it. While I track your joints, what movement is this?", "Nice. I'm tracking your joints now. Which movement are you doing?", "Thanks! Tracking your body now. What exercise is this?"]) },
    ]);
    setStage("movement");
    try {
      const r = await extractPose(url, { onProgress: (fraction, s) => setProgress({ stage: s, fraction }), signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      setExtracted(r);
      extractedRef.current = r;
      if (r.detectedFraction < 0.2) {
        coach(
          `I couldn't find a person in ${r.detectedFraction === 0 ? "any" : "most"} of this clip, so I can't review it. Film from the side with your whole body in frame and good light, then send it again.`,
        );
        choiceRef.current = null;
        setStage("upload");
        return;
      }
      if (r.pose.view === "front") {
        coach(
          "You filmed from the front, so I'll check whether your knees cave in. Depth, forward lean and heel lift need a side view, so send a side-on clip too if you want those checked.",
          "muted",
        );
      }
      if (r.detectedFraction < 0.5) {
        coach(`I could only find you in ${Math.round(r.detectedFraction * 100)}% of the frames, so the review may be rough. Better light and your whole body in frame help a lot.`, "muted");
      }
      if (choiceRef.current) proceed(r, choiceRef.current);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setExtractError((e as Error).message);
      coach(`I couldn't track that clip: ${(e as Error).message}`);
      setStage("upload");
    }
  }

  function chooseMovement(id: string) {
    const label = id === "detect" ? "Not sure, can you tell?" : MOVEMENT_CHOICES.find((c) => c.id === id)!.label;
    push({ from: "user", kind: "text", text: label });
    choiceRef.current = id;
    if (extractedRef.current) proceed(extractedRef.current, id);
    else setStage("waiting");
  }

  function confirmMovement(id: string) {
    push({ from: "user", kind: "text", text: id === guess?.movementId ? "Yes, that's it" : `It's a ${MOVEMENT_CHOICES.find((c) => c.id === id)?.label.toLowerCase()}` });
    setMovementId(id);
    askContext();
  }

  async function review(note: string) {
    if (!extracted || !movementId) return;
    push({ from: "user", kind: "text", text: note || "Skip" });
    setInput("");
    setStage("reviewing");
    const traceId = push({ from: "coach", kind: "trace", trace: null });
    const parsed = parseSetNote(note);
    const req: FormCoachRequest = {
      movementId: movementId as FormCoachRequest["movementId"],
      pose: extracted.pose,
      set: { ...(note ? { note: note.slice(0, 300) } : {}), ...parsed },
      profile,
      formHistory: loadFormHistory(),
      log: state?.log ?? [],
      now: { date: now?.date ?? new Date().toISOString().slice(0, 10) },
    };
    setLastRequest(req);
    try {
      const r = await fetch("/api/form-coach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
      const res = data as FormCoachResponse;
      setResult(res);
      setMsgs((xs) => xs.map((m) => (m.id === traceId && m.kind === "trace" ? { ...m, trace: res.trace ?? [], generatedBy: res.generatedBy } : m)));
      push({ from: "coach", kind: "result", result: res });
      if (res.safety) coach(res.safety, "safety");
      if (res.error) coach("The AI coach didn't answer this time, so this is the rule-based review.", "muted");
      if (res.quality.ok) {
        saveFormSession({
          date: req.now.date,
          movementId: req.movementId,
          ...(req.set.loadKg !== undefined ? { loadKg: req.set.loadKg } : {}),
          ...(req.set.rpe !== undefined ? { rpe: req.set.rpe } : {}),
          reps: res.repCount,
          faults: res.measured.map((f) => f.faultId),
        });
      }
      setChat([{ role: "coach", content: feedbackText(res) }]);
      setFollowups(
        res.feedback.findings.length
          ? ["Why does this happen?", "What should I change next session?", "Is there an easier variation?"]
          : ["What should I work on next?", "How do I progress this?"],
      );
      setStage("chat");
    } catch (e) {
      setMsgs((xs) => xs.filter((m) => m.id !== traceId));
      coach(`Something went wrong reviewing that set: ${(e as Error).message}`);
      setStage("context");
    }
  }

  async function ask(text: string) {
    const q = text.trim();
    if (!q || !lastRequest || !result) return;
    push({ from: "user", kind: "text", text: q });
    setInput("");
    const history = [...chat, { role: "user" as const, content: q }].slice(-20);
    setChat(history);
    setThinking(true);
    try {
      const r = await fetch("/api/form-coach/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...lastRequest, previousFeedback: feedbackText(result), messages: history }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
      const res = data as FormChatResponse;
      if (res.safety) coach(res.safety, "safety");
      coach(res.message);
      setChat((h) => [...h, { role: "coach" as const, content: res.message }].slice(-20));
      setFollowups(res.followups);
    } catch (e) {
      coach(`I couldn't answer that: ${(e as Error).message}`, "muted");
    } finally {
      setThinking(false);
    }
  }

  function startOver() {
    abortRef.current?.abort();
    setStage("upload");
    setExtracted(null);
    extractedRef.current = null;
    setResult(null);
    choiceRef.current = null;
    setMovementId(null);
    setGuess(null);
    setChat([]);
    setFollowups([]);
    setProgress(null);
    coach(pick(["Sure, send me another clip.", "Ready for the next one.", "Go ahead, send the next set."]));
  }

  const chatEnabled = Boolean(ai?.ai);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pt-8 pb-40 sm:px-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-coral-deep">
            <Sparkle width={14} height={14} /> Form correction
          </p>
          <h1 className="mt-2 font-display text-4xl font-medium tracking-tight">Your form coach</h1>
          <p className="mt-2 max-w-xl text-sm text-ink-soft">
            Upload one set. Pivot tracks 17 joints, measures every rep, works out the likely cause of what went wrong, and suggests what to change.
          </p>
        </div>
        {stage !== "upload" && (
          <Button variant="ghost" className="h-9 shrink-0 px-3" onClick={startOver}>
            New clip
          </Button>
        )}
      </div>

      {!state?.profile && state !== null && (
        <p className="mb-4 rounded-2xl border border-line bg-paper-deep px-4 py-3 text-sm text-ink-soft">
          I&apos;m assuming dumbbells, a bench and bands.{" "}
          <Link href="/onboarding" className="font-semibold text-ink underline underline-offset-4">
            Set up your profile
          </Link>{" "}
          for fixes that match your equipment.
        </p>
      )}

      <div className="flex flex-col gap-3" aria-live="polite">
        {msgs.map((m) => (
          <Bubble key={m.id} from={m.from} wide={m.kind === "result"}>
            {m.kind === "text" && (
              <p className={cx("whitespace-pre-line", m.tone === "muted" && "text-ink-soft", m.tone === "safety" && "font-semibold text-coral-ink")}>
                {m.tone === "safety" && <Shield width={15} height={15} className="mr-1.5 inline -translate-y-px" />}
                {m.text}
              </p>
            )}
            {m.kind === "video" && (
              <div className="flex flex-col gap-1">
                <video src={m.url} muted playsInline className="max-h-52 rounded-xl bg-ink" />
                <span className="text-xs text-paper/70">{m.name}</span>
              </div>
            )}
            {m.kind === "progress" && <ProgressLine progress={progress} done={Boolean(extracted)} error={extractError} frames={extracted?.pose.frames.length} />}
            {m.kind === "trace" && <TraceView trace={m.trace} generatedBy={m.generatedBy} movement={movementId ? MOVEMENTS[movementId].name : "movement"} />}
            {m.kind === "result" && videoUrl && extracted && <FeedbackCard result={m.result} videoUrl={videoUrl} pose={extracted.pose} />}
          </Bubble>
        ))}
        {stage === "waiting" && !extracted && (
          <Bubble from="coach">
            <p className="text-ink-soft">Still tracking, almost there…</p>
          </Bubble>
        )}
        {thinking && (
          <Bubble from="coach">
            <Dots />
          </Bubble>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer: what you can do next depends on where we are in the conversation. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-4 sm:px-6">
          {stage === "upload" && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files[0];
                if (f) onFile(f);
              }}
              className={cx(
                "flex flex-col items-center justify-between gap-3 rounded-2xl border-2 border-dashed px-4 py-4 sm:flex-row",
                dragging ? "border-coral bg-coral-soft" : "border-line-strong",
              )}
            >
              <span className="text-sm text-ink-soft">Drop a video here, or</span>
              <Button onClick={() => fileRef.current?.click()}>
                Upload a set <ArrowRight width={16} height={16} />
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          {stage === "movement" && (
            <div className="flex flex-wrap gap-2">
              {MOVEMENT_CHOICES.map((c) => (
                <Chip key={c.id} selected={false} onClick={() => chooseMovement(c.id)}>
                  {c.label}
                </Chip>
              ))}
              <Chip selected={false} onClick={() => chooseMovement("detect")} className="border-coral/60 text-coral-deep">
                <Sparkle width={14} height={14} /> Detect it for me
              </Chip>
            </div>
          )}

          {stage === "confirm" && (
            <div className="flex flex-wrap gap-2">
              {guess?.movementId && (
                <Chip selected onClick={() => confirmMovement(guess.movementId!)}>
                  Yes, that&apos;s it
                </Chip>
              )}
              {MOVEMENT_CHOICES.filter((c) => c.id !== guess?.movementId).map((c) => (
                <Chip key={c.id} selected={false} onClick={() => confirmMovement(c.id)}>
                  {guess?.movementId ? `No, it's a ${c.label.toLowerCase()}` : c.label}
                </Chip>
              ))}
            </div>
          )}

          {(stage === "context" || stage === "chat") && (
            <>
              {stage === "chat" && followups.length > 0 && chatEnabled && (
                <div className="flex flex-wrap gap-2">
                  {followups.map((f) => (
                    <Chip key={f} selected={false} onClick={() => ask(f)} className="text-xs">
                      {f}
                    </Chip>
                  ))}
                </div>
              )}
              {stage === "chat" && !chatEnabled ? (
                <p className="text-sm text-ink-soft">Follow-up questions need the AI coach, which isn&apos;t configured on this server.</p>
              ) : (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (stage === "context") review(input.trim());
                    else ask(input);
                  }}
                >
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    maxLength={stage === "context" ? 300 : 800}
                    disabled={thinking}
                    placeholder={stage === "context" ? "e.g. 20 kg goblet squat, felt like RPE 8" : "Ask your coach anything about this set"}
                    className="h-11 min-w-0 flex-1 rounded-full border border-line-strong bg-card px-4 text-sm outline-none focus:border-ink"
                  />
                  {stage === "context" && (
                    <Button variant="secondary" onClick={() => review("")}>
                      Skip
                    </Button>
                  )}
                  <Button type="submit" disabled={thinking || (stage === "chat" && !input.trim())}>
                    {stage === "context" ? "Review my set" : "Send"}
                  </Button>
                </form>
              )}
            </>
          )}

          {stage === "reviewing" && <p className="text-sm text-ink-soft">Your coach is reviewing the set. This usually takes 10–30 seconds.</p>}
          {stage === "waiting" && <p className="text-sm text-ink-soft">Finishing the joint tracking…</p>}
        </div>
      </div>
    </div>
  );
}

function Bubble({ from, wide, children }: { from: "coach" | "user"; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cx("flex animate-rise", from === "user" ? "justify-end" : "justify-start")}>
      <div
        className={cx(
          "rounded-3xl px-4 py-3 text-[15px] leading-relaxed",
          wide ? "w-full" : "max-w-[85%]",
          from === "user" ? "rounded-br-lg bg-ink text-paper" : "rounded-bl-lg border border-line bg-card text-ink shadow-card",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function Dots() {
  return (
    <span className="inline-flex gap-1" aria-label="Coach is typing">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-2 w-2 animate-pulse rounded-full bg-ink-faint" style={{ animationDelay: `${i * 150}ms` }} />
      ))}
    </span>
  );
}

function ProgressLine({
  progress,
  done,
  error,
  frames,
}: {
  progress: { stage: "model" | "tracking"; fraction: number } | null;
  done: boolean;
  error: string | null;
  frames?: number;
}) {
  if (error) return <p className="text-sm text-coral-ink">Tracking stopped.</p>;
  const pct = done ? 100 : Math.round((progress?.fraction ?? 0) * 100);
  const label = done
    ? `Tracked 17 joints across ${frames} frames.`
    : progress?.stage === "tracking"
      ? `Tracking 17 joints, frame by frame… ${pct}%`
      : "Loading the pose model (first time only)…";
  return (
    <div className="flex min-w-[220px] flex-col gap-2">
      <p className="text-sm text-ink-soft">{label}</p>
      <div className="h-1.5 overflow-hidden rounded-full bg-paper-deep">
        <div className={cx("h-full rounded-full transition-all", done ? "bg-sage" : "bg-coral")} style={{ width: `${progress?.stage === "model" && !done ? 8 : pct}%` }} />
      </div>
    </div>
  );
}

function TraceView({ trace, generatedBy, movement }: { trace: TraceStep[] | null; generatedBy?: FormCoachResponse["generatedBy"]; movement: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (trace) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1800);
    return () => window.clearInterval(id);
  }, [trace]);
  const steps = useMemo(() => {
    if (!trace) return null;
    const seen = new Set<string>();
    return trace
      .filter((s) => s.ok && !seen.has(s.tool) && seen.add(s.tool))
      .map((s) => (STEP_LABELS[s.tool] ?? (() => s.tool))(movement));
  }, [trace, movement]);

  if (!steps) {
    return (
      <ul className="flex flex-col gap-1.5 text-sm">
        {PENDING_STEPS.slice(0, Math.min(PENDING_STEPS.length, tick + 1)).map((s, i, arr) => (
          <li key={s} className={cx("flex items-center gap-2", i === arr.length - 1 ? "text-ink" : "text-ink-faint")}>
            <span className={cx("h-2 w-2 rounded-full", i === arr.length - 1 ? "animate-pulse bg-coral" : "bg-sage")} />
            {s}
            {i === arr.length - 1 && "…"}
          </li>
        ))}
      </ul>
    );
  }
  if (generatedBy === "rule_based") {
    return <p className="text-sm text-ink-soft">Measured every rep and checked it against the fault rules (rule-based review, no AI).</p>;
  }
  return (
    <div className="text-sm">
      <p className="mb-1.5 font-semibold">What I did</p>
      <ol className="flex flex-col gap-1">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-2 text-ink-soft">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sage-soft text-[11px] font-semibold text-sage-ink">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}
