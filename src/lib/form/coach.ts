/**
 * The form coach: measured analysis + an agent loop that investigates with
 * tools, diagnoses a likely cause, and proposes changes, followed by a
 * deterministic gate that removes anything it can't back up.
 *
 *   keypoints ──► analyzeMovement (code) ──► tools ◄──► model (loop)
 *                                                   │ submit_coaching
 *                                                   ▼
 *                                     grounding gate (code) ──► response
 *
 * The model can only report faults the code measured, can only name causes
 * listed in the movement guide, and can only suggest exercises and drills the
 * user can actually do. Without an API key the same pipeline runs with a
 * rule-based coach instead of the model.
 */
import { z } from "zod";
import { EXERCISES_BY_ID } from "../catalog";
import { filterFromProfile, type ExerciseFilter } from "../planner/generate";
import { FitnessProfile, IsoDate, WorkoutLogEntry } from "../schemas";
import { aiEnabled } from "../agent/llm";
import { runToolLoop, tool, type LoopClient, type TraceStep } from "../agent/loop";
import { analyzeMovement, type FaultFinding, type FormAnalysis } from "./analyze";
import { compareToGolden, type GoldenComparison, type GoldenReference } from "./golden";
import { DRILLS, FEATURES, findFault, getMovement, MOVEMENT_IDS, type Fix, type MovementGuide } from "./movements";
import { PoseSequence } from "./pose";
import { FormSessionSummary } from "./schemas";
import { REFERENCES } from "./references";

// ---------- request ----------

export { FormSessionSummary } from "./schemas";

export const FormCoachRequest = z.object({
  movementId: z.enum(MOVEMENT_IDS),
  exerciseId: z.string().optional(),
  pose: PoseSequence,
  set: z
    .object({
      loadKg: z.number().min(0).max(500).optional(),
      targetReps: z.number().int().min(1).max(100).optional(),
      rpe: z.number().min(1).max(10).optional(),
      note: z.string().trim().max(300).optional(),
    })
    .default({}),
  profile: FitnessProfile,
  formHistory: z.array(FormSessionSummary).max(30).default([]),
  log: z.array(WorkoutLogEntry).max(300).default([]),
  now: z.object({ date: IsoDate }),
});
export type FormCoachRequest = z.infer<typeof FormCoachRequest>;

// ---------- model output ----------

export const CHANGE_KINDS = ["regress_exercise", "swap_exercise", "reduce_load", "add_drill", "keep_going", "retest"] as const;

const CoachOutput = z.object({
  headline: z.string().max(160).describe("One sentence the user sees first: the main thing to fix, or what went well."),
  praise: z.string().max(200).nullish().describe("Something measured that went well, if anything."),
  findings: z
    .array(
      z.object({
        fault_id: z.string().describe("id from get_measured_faults"),
        reps: z.array(z.number().int()).describe("rep numbers where it happened"),
        likely_cause: z.string().describe("a cause id from the movement guide for this fault, or 'unclear'"),
        cause_evidence: z.string().max(300).describe("the specific measurements or history that point to this cause"),
        confidence: z.enum(["low", "medium", "high"]),
      }),
    )
    .max(3)
    .describe("Most important first. Empty if nothing was measured."),
  cues: z.array(z.string().max(160)).max(2).describe("At most two short coaching cues for the next set."),
  changes: z
    .array(
      z.object({
        kind: z.enum(CHANGE_KINDS),
        exercise_id: z.string().nullish().describe("regress/swap: a catalog id from find_fixes"),
        drill_id: z.string().nullish().describe("add_drill: a drill id from find_fixes"),
        load_change_pct: z.number().nullish().describe("reduce_load: e.g. -10"),
        reason: z.string().max(200),
      }),
    )
    .max(3),
  retest: z.string().max(200).nullish().describe("What to film next session to check the fix."),
  cannot_assess: z.array(z.string().max(160)).max(4).describe("Things the user may care about that this clip can't show."),
});
export type CoachOutput = z.infer<typeof CoachOutput>;

// ---------- response ----------

export interface CoachFinding {
  faultId: string;
  label: string;
  reps: number[];
  cause: { id: string; label: string } | null;
  evidence: string;
  confidence: "low" | "medium" | "high";
}

export interface CoachChange {
  kind: (typeof CHANGE_KINDS)[number];
  exerciseId?: string;
  exerciseName?: string;
  drillId?: string;
  drillName?: string;
  drillHow?: string;
  loadChangePct?: number;
  reason: string;
}

export interface FormCoachResponse {
  generatedBy: "agent" | "rule_based";
  movement: { id: string; name: string; recording: string };
  quality: FormAnalysis["quality"];
  repCount: number;
  /** Rep timing for the video overlay. */
  reps: { n: number; startMs: number; bottomMs: number; endMs: number; faults: string[] }[];
  overlay: { side: "left" | "right"; primary: MovementGuide["primary"] };
  measured: FaultFinding[];
  golden: Pick<GoldenComparison, "available" | "deviations" | "shapeSimilarity" | "note">;
  feedback: {
    headline: string;
    praise: string | null;
    findings: CoachFinding[];
    cues: string[];
    changes: CoachChange[];
    retest: string | null;
    cannotAssess: string[];
  };
  safety: string | null;
  /** What the gate removed from the model's answer, and why. Shown in study tools and evals, not to users. */
  dropped: string[];
  trace?: TraceStep[];
  usage?: { model: string; inputTokens: number; outputTokens: number };
  error?: string;
}

// ---------- context helpers ----------

const PAIN = /\b(pain|painful|hurts?|hurting|injur\w*|sharp|tweak\w*|strain\w*|ache|aching|numb\w*|tingl\w*)\b/i;
export const SAFETY_NOTE =
  "You mentioned pain. Form feedback can't diagnose or fix pain: stop this movement for today, and if it continues, check with a doctor or physical therapist.";

function canDo(exerciseId: string, f: ExerciseFilter): boolean {
  const e = EXERCISES_BY_ID[exerciseId];
  if (!e) return false;
  const rank = { beginner: 0, intermediate: 1, advanced: 2 } as const;
  return (
    e.equipment.every((x) => f.equipment.includes(x)) &&
    !e.tags.some((t) => f.avoidTags.includes(t)) &&
    !f.avoidExerciseIds.includes(e.id) &&
    rank[e.level] <= rank[f.experience]
  );
}

function canDoDrill(drillId: string, f: ExerciseFilter): boolean {
  const d = DRILLS[drillId];
  return Boolean(d) && d.equipment.every((x) => (f.equipment as string[]).includes(x));
}

function allowedFixes(m: MovementGuide, faultId: string, f: ExerciseFilter) {
  const rule = findFault(m, faultId);
  if (!rule) return null;
  const fixes = rule.fixes
    .filter((x) => (x.kind === "regression" ? canDo(x.ref!, f) : x.kind === "drill" ? canDoDrill(x.ref!, f) : true))
    .map((x) => describeFix(x));
  const swaps = m.exerciseIds.filter((id) => canDo(id, f)).map((id) => ({ exercise_id: id, name: EXERCISES_BY_ID[id].name }));
  return { fault: rule.label, fixes, otherVariationsYouCanDo: swaps };
}

function describeFix(x: Fix) {
  if (x.kind === "regression") return { kind: "regress_exercise", exercise_id: x.ref, name: EXERCISES_BY_ID[x.ref!]?.name, why: x.text };
  if (x.kind === "drill") return { kind: "add_drill", drill_id: x.ref, name: DRILLS[x.ref!]?.name, how: DRILLS[x.ref!]?.how, why: x.text };
  if (x.kind === "load") return { kind: "reduce_load", why: x.text };
  return { kind: "cue", why: x.text };
}

function historySignals(req: FormCoachRequest, analysis: FormAnalysis) {
  const past = req.formHistory
    .filter((h) => h.movementId === req.movementId && h.date <= req.now.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const lastWithLoad = past.find((h) => h.loadKg !== undefined);
  const loadChangePct =
    req.set.loadKg !== undefined && lastWithLoad?.loadKg ? Math.round(((req.set.loadKg - lastWithLoad.loadKg) / lastWithLoad.loadKg) * 100) : null;
  const recurring: Record<string, number> = {};
  for (const h of past.slice(0, 5)) for (const f of h.faults) recurring[f] = (recurring[f] ?? 0) + 1;
  const weekAgo = new Date(Date.parse(req.now.date) - 7 * 86400000).toISOString().slice(0, 10);
  const recent = req.log.filter((l) => l.date >= weekAgo && l.date <= req.now.date && l.status === "completed");
  return {
    experience: req.profile.experience,
    thisSet: {
      loadKg: req.set.loadKg ?? null,
      targetReps: req.set.targetReps ?? null,
      repsDone: analysis.reps.length,
      rpe: req.set.rpe ?? null,
      userNote: req.set.note ?? null,
    },
    load: { lastSessionKg: lastWithLoad?.loadKg ?? null, lastSessionDate: lastWithLoad?.date ?? null, changePct: loadChangePct },
    previousSessions: past.slice(0, 5).map((h) => ({ date: h.date, loadKg: h.loadKg ?? null, rpe: h.rpe ?? null, faults: h.faults })),
    recurringFaults: recurring,
    withinSetTrends: analysis.trends,
    trainingLast7Days: { completedSessions: recent.length, minutes: recent.reduce((a, l) => a + l.durationMin, 0) },
    limitations: req.profile.limitations || null,
  };
}

// ---------- tools ----------

export function buildTools(req: FormCoachRequest, m: MovementGuide, analysis: FormAnalysis, golden: GoldenComparison, filter: ExerciseFilter) {
  return [
    tool({
      name: "get_movement_guide",
      description: "How the movement should look: setup, phases, checkpoints, the faults we can measure with their possible causes, and what this camera view cannot show.",
      schema: z.object({}),
      run: () => ({
        name: m.name,
        description: m.description,
        phases: m.phases,
        checkpoints: m.checkpoints,
        measurableFaults: m.faults.map((f) => ({
          fault_id: f.id,
          label: f.label,
          meaning: f.meaning,
          rule: `${f.feature} ${f.op} ${f.threshold}${f.view ? ` (${f.view} view only)` : ""}`,
          causes: f.causes.map((c) => ({ cause_id: c.id, label: c.label, signals: c.signals })),
        })),
        cannotAssess: m.cannotAssess,
      }),
    }),
    tool({
      name: "get_rep_metrics",
      description: "Measured numbers for each rep, plus clip quality. Optionally pass rep numbers to see only those reps.",
      schema: z.object({ reps: z.array(z.number().int().min(1)).max(30).nullish() }),
      run: ({ reps }) => ({
        quality: analysis.quality,
        featureMeanings: Object.fromEntries(m.features.map((f) => [f, FEATURES[f]])),
        median: analysis.summary,
        reps: analysis.reps.filter((r) => !reps?.length || reps.includes(r.n)).map((r) => ({ rep: r.n, ...r.features })),
      }),
    }),
    tool({
      name: "get_measured_faults",
      description: "Faults the rule checks found, with the reps, values and pattern (consistent, late_reps, occasional). These are the only faults you may report.",
      schema: z.object({}),
      run: () =>
        analysis.quality.ok
          ? { faults: analysis.faults, trendsWithinSet: analysis.trends }
          : { faults: [], note: "Clip quality is too low to measure faults.", issues: analysis.quality.issues },
    }),
    tool({
      name: "compare_to_golden",
      description: "How this set differs from the golden examples of good form for this movement (feature deviations and motion-shape similarity per rep).",
      schema: z.object({}),
      run: () => golden,
    }),
    tool({
      name: "get_history_signals",
      description: "Context for diagnosing the cause: this set's load, RPE and note, load change from last session, recent sessions' faults, within-set trends, and training volume this week.",
      schema: z.object({}),
      run: () => historySignals(req, analysis),
    }),
    tool({
      name: "find_fixes",
      description: "Regressions, drills and load changes for one fault, filtered to what this user can do with their equipment and restrictions.",
      schema: z.object({ fault_id: z.string() }),
      run: ({ fault_id }) => allowedFixes(m, fault_id, filter) ?? { error: `Unknown fault_id ${fault_id} for ${m.id}.` },
    }),
  ];
}

const SYSTEM = `You are Pivot's form coach. You review one set of an exercise that the app has already measured from the user's video.

How to work:
1. Read the movement guide and the measured faults. Look at rep metrics, the golden comparison and history signals as needed.
2. Pick the one or two faults that matter most. Report only faults returned by get_measured_faults, using their fault_id.
3. For each, choose the most likely cause from that fault's causes in the guide, and cite the evidence (rep numbers, values, load change, trends, history). If the evidence doesn't separate the causes, use "unclear" and low confidence.
4. Call find_fixes and suggest at most three changes from what it returns. Prefer the smallest change that addresses the cause: a cue or drill for technique, a load drop for load, fewer reps or rest for fatigue.
5. Ask for a specific retest clip next session.

Rules:
- Never invent a fault, measurement, exercise or drill. If nothing was measured, say the set looked solid and what to keep doing.
- If clip quality is too low, report no faults and explain how to film again.
- Say what this camera view can't show (cannot_assess) instead of guessing about it.
- No medical or rehab advice and no diagnosis of injuries. If the user mentions pain, tell them to stop the movement and see a professional.
- Be direct and brief. Cues are short phrases the user can think about mid-rep.
- When done, call submit_coaching.`;

function userPrompt(req: FormCoachRequest, m: MovementGuide, analysis: FormAnalysis, golden: GoldenComparison) {
  const ex = req.exerciseId ? EXERCISES_BY_ID[req.exerciseId]?.name ?? req.exerciseId : m.name;
  return [
    `Movement: ${m.name} (${ex}).`,
    `Clip: ${analysis.quality.durationS}s, ${analysis.quality.view} view, quality ${analysis.quality.ok ? "OK" : "too low"}, ${analysis.reps.length} reps found.`,
    `Measured faults: ${analysis.faults.length ? analysis.faults.map((f) => f.faultId).join(", ") : "none"}.`,
    `Golden reference: ${golden.available ? `${golden.goldenClips} clips` : "not built yet"}.`,
    req.set.note ? `User's note: "${req.set.note}"` : "",
    "Investigate with the tools, then call submit_coaching.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------- gate ----------

export function gate(out: CoachOutput, m: MovementGuide, analysis: FormAnalysis, filter: ExerciseFilter): { feedback: FormCoachResponse["feedback"]; dropped: string[] } {
  const dropped: string[] = [];
  const measured = new Map(analysis.faults.map((f) => [f.faultId, f]));
  const findings: CoachFinding[] = [];
  if (analysis.quality.ok) {
    for (const f of out.findings) {
      const fault = measured.get(f.fault_id);
      if (!fault) {
        dropped.push(`finding ${f.fault_id}: not among the measured faults`);
        continue;
      }
      if (findings.some((x) => x.faultId === f.fault_id)) continue;
      const rule = findFault(m, f.fault_id)!;
      const reps = f.reps.filter((r) => fault.reps.includes(r));
      if (reps.length < f.reps.length) dropped.push(`finding ${f.fault_id}: removed reps not measured as faulty`);
      const cause = rule.causes.find((c) => c.id === f.likely_cause) ?? null;
      if (!cause && f.likely_cause !== "unclear") dropped.push(`finding ${f.fault_id}: cause "${f.likely_cause}" is not in the guide`);
      findings.push({
        faultId: f.fault_id,
        label: rule.label,
        reps: reps.length ? reps : fault.reps,
        cause: cause ? { id: cause.id, label: cause.label } : null,
        evidence: f.cause_evidence,
        confidence: cause ? f.confidence : "low",
      });
    }
  } else if (out.findings.length) dropped.push("all findings: clip quality too low to measure faults");

  const changes: CoachChange[] = [];
  for (const c of out.changes) {
    if (!analysis.quality.ok && c.kind !== "retest") {
      dropped.push(`change ${c.kind}: clip quality too low`);
      continue;
    }
    if (c.kind === "regress_exercise" || c.kind === "swap_exercise") {
      if (!c.exercise_id || !canDo(c.exercise_id, filter)) {
        dropped.push(`change ${c.kind}: ${c.exercise_id ?? "no exercise"} is not in the catalog or not available to this user`);
        continue;
      }
      changes.push({ kind: c.kind, exerciseId: c.exercise_id, exerciseName: EXERCISES_BY_ID[c.exercise_id].name, reason: c.reason });
    } else if (c.kind === "add_drill") {
      if (!c.drill_id || !canDoDrill(c.drill_id, filter)) {
        dropped.push(`change add_drill: ${c.drill_id ?? "no drill"} is not a known drill the user can do`);
        continue;
      }
      const d = DRILLS[c.drill_id];
      changes.push({ kind: c.kind, drillId: c.drill_id, drillName: d.name, drillHow: d.how, reason: c.reason });
    } else if (c.kind === "reduce_load") {
      const pct = Math.max(-30, Math.min(-5, c.load_change_pct ?? -10));
      if (pct !== c.load_change_pct) dropped.push(`change reduce_load: clamped to ${pct}%`);
      changes.push({ kind: c.kind, loadChangePct: pct, reason: c.reason });
    } else changes.push({ kind: c.kind, reason: c.reason });
  }

  const cannotAssess = [...new Set([...out.cannot_assess, ...(analysis.quality.ok ? [] : analysis.quality.issues)])].slice(0, 5);
  const headline = analysis.quality.ok ? out.headline : `I couldn't measure this clip reliably. ${analysis.quality.issues[0] ?? ""}`.trim();
  return {
    feedback: {
      headline,
      praise: analysis.quality.ok ? out.praise ?? null : null,
      findings,
      cues: out.cues.slice(0, 2),
      changes: changes.slice(0, 3),
      retest: out.retest ?? (analysis.quality.ok ? null : m.recording),
      cannotAssess,
    },
    dropped,
  };
}

// ---------- rule-based coach (no model) ----------

export function ruleBasedCoach(req: FormCoachRequest, m: MovementGuide, analysis: FormAnalysis, filter: ExerciseFilter): CoachOutput {
  if (!analysis.quality.ok)
    return { headline: "Let's film that again.", findings: [], cues: [], changes: [], retest: m.recording, cannot_assess: [] };
  const top = analysis.faults[0];
  if (!top)
    return {
      headline: `Solid set: ${analysis.reps.length} reps with no measured faults.`,
      praise: "Every rep passed the checks this view can measure.",
      findings: [],
      cues: [],
      changes: [{ kind: "keep_going", reason: "Nothing measured to fix." }],
      retest: null,
      cannot_assess: m.cannotAssess.slice(0, 2),
    };
  const rule = findFault(m, top.faultId)!;
  const signals = historySignals(req, analysis);
  const has = (id: string) => rule.causes.some((c) => c.id === id);
  let cause = "unclear";
  let evidence = "The data doesn't separate the possible causes yet.";
  if (top.pattern === "late_reps" && has("fatigue")) {
    cause = "fatigue";
    evidence = `Only reps ${top.reps.join(", ")} of ${analysis.reps.length} broke the rule; the early reps were fine.`;
  } else if ((signals.load.changePct ?? 0) >= 10 && has("load_too_heavy")) {
    cause = "load_too_heavy";
    evidence = `Load went up ${signals.load.changePct}% since ${signals.load.lastSessionDate}.`;
  } else if (top.pattern === "consistent" && req.profile.experience === "beginner" && has("technique_unfamiliar")) {
    cause = "technique_unfamiliar";
    evidence = "Consistent from the first rep at your experience level, with no load change.";
  }
  const fixes = allowedFixes(m, top.faultId, filter)?.fixes ?? [];
  const changes: CoachOutput["changes"] = [];
  const pick = (kind: string) => fixes.find((f) => f.kind === kind);
  const preferred = cause === "load_too_heavy" ? ["reduce_load", "add_drill"] : cause === "fatigue" ? ["reduce_load"] : ["add_drill", "regress_exercise"];
  for (const k of preferred) {
    const f = pick(k);
    if (!f) continue;
    if (f.kind === "reduce_load") changes.push({ kind: "reduce_load", load_change_pct: -10, reason: f.why });
    else if (f.kind === "add_drill") changes.push({ kind: "add_drill", drill_id: (f as { drill_id?: string }).drill_id, reason: f.why });
    else if (f.kind === "regress_exercise") changes.push({ kind: "regress_exercise", exercise_id: (f as { exercise_id?: string }).exercise_id, reason: f.why });
  }
  return {
    headline: `Main thing to fix: ${rule.label.toLowerCase()} (${top.reps.length === 1 ? "rep" : "reps"} ${top.reps.join(", ")}).`,
    findings: [{ fault_id: top.faultId, reps: top.reps, likely_cause: cause, cause_evidence: evidence, confidence: cause === "unclear" ? "low" : "medium" }],
    cues: rule.cues.slice(0, 1),
    changes,
    retest: `Film the same ${m.name.toLowerCase()} from the ${m.view} next session so we can compare.`,
    cannot_assess: m.cannotAssess.slice(0, 2),
  };
}

// ---------- entry point ----------

export interface CoachOptions {
  client?: LoopClient;
  references?: Record<string, GoldenReference>;
  /** Force the rule-based coach even if AI is configured (evals and fallback). */
  ruleBased?: boolean;
  maxSteps?: number;
  model?: string;
}

export async function coachForm(req: FormCoachRequest, o: CoachOptions = {}): Promise<FormCoachResponse> {
  const m = getMovement(req.movementId);
  if (!m) throw new Error(`Unknown movement ${req.movementId}.`);
  const analysis = analyzeMovement(req.pose, m);
  const golden = compareToGolden(analysis, (o.references ?? REFERENCES)[m.id]);
  const filter = filterFromProfile(req.profile);
  const safety = req.set.note && PAIN.test(req.set.note) ? SAFETY_NOTE : null;

  const base = {
    movement: { id: m.id, name: m.name, recording: m.recording },
    quality: analysis.quality,
    repCount: analysis.reps.length,
    reps: analysis.reps.map((r) => ({
      n: r.n,
      startMs: req.pose.frames[r.start].t,
      bottomMs: req.pose.frames[r.bottom].t,
      endMs: req.pose.frames[r.end].t,
      faults: analysis.faults.filter((f) => f.reps.includes(r.n)).map((f) => f.faultId),
    })),
    overlay: { side: analysis.quality.side, primary: m.primary },
    measured: analysis.faults,
    golden: { available: golden.available, deviations: golden.deviations, shapeSimilarity: golden.shapeSimilarity, note: golden.note },
    safety,
  };

  const useAgent = !o.ruleBased && (o.client || aiEnabled());
  if (useAgent) {
    try {
      const run = await runToolLoop({
        system: SYSTEM,
        user: userPrompt(req, m, analysis, golden),
        tools: buildTools(req, m, analysis, golden, filter),
        final: { name: "submit_coaching", description: "Submit the coaching feedback. This ends the review.", schema: CoachOutput },
        maxSteps: o.maxSteps ?? 8,
        model: o.model,
        client: o.client,
      });
      const { feedback, dropped } = gate(run.output, m, analysis, filter);
      return { generatedBy: "agent", ...base, feedback, dropped, trace: run.trace, usage: run.usage };
    } catch (e) {
      const { feedback, dropped } = gate(ruleBasedCoach(req, m, analysis, filter), m, analysis, filter);
      return { generatedBy: "rule_based", ...base, feedback, dropped, error: `AI coach failed, showing rule-based feedback: ${(e as Error).message}` };
    }
  }
  const { feedback, dropped } = gate(ruleBasedCoach(req, m, analysis, filter), m, analysis, filter);
  return { generatedBy: "rule_based", ...base, feedback, dropped };
}


// ---------- follow-up chat ----------

export const FormChatRequest = FormCoachRequest.extend({
  /** What the coach already told the user, as plain text. */
  previousFeedback: z.string().max(4000),
  messages: z
    .array(z.object({ role: z.enum(["user", "coach"]), content: z.string().trim().min(1).max(1500) }))
    .min(1)
    .max(20),
});
export type FormChatRequest = z.infer<typeof FormChatRequest>;

const ChatReply = z.object({
  message: z.string().max(1200).describe("Your reply to the user: conversational, specific to their clip, at most about 120 words."),
  followups: z.array(z.string().max(80)).max(3).describe("Up to three short follow-up questions the user might tap next."),
});

export interface FormChatResponse {
  message: string;
  followups: string[];
  safety: string | null;
  trace: TraceStep[];
  usage: { model: string; inputTokens: number; outputTokens: number };
}

const CHAT_SYSTEM = `You are Pivot's form coach, in a conversation about one set the user filmed. You already gave feedback (below). Now answer their follow-up questions.

Use the tools to look up the measured numbers, the movement guide, history and fixes before answering anything specific. Rules:
- Only state measurements and faults the tools return. If something can't be seen from this clip, say so.
- Only suggest exercises and drills that find_fixes returns for this user.
- No medical or rehab advice and no injury diagnosis. If they mention pain, tell them to stop the movement and see a professional.
- Be warm, direct and brief, like a good coach between sets. Use rep numbers and numbers from the data when they help.
- Finish by calling reply.`;

export async function chatAboutForm(req: FormChatRequest, o: Pick<CoachOptions, "client" | "references" | "model"> = {}): Promise<FormChatResponse> {
  const m = getMovement(req.movementId);
  if (!m) throw new Error(`Unknown movement ${req.movementId}.`);
  const analysis = analyzeMovement(req.pose, m);
  const golden = compareToGolden(analysis, (o.references ?? REFERENCES)[m.id]);
  const filter = filterFromProfile(req.profile);
  const last = req.messages[req.messages.length - 1];
  const transcript = req.messages.map((x) => `${x.role === "user" ? "User" : "Coach"}: ${x.content}`).join("\n");
  const run = await runToolLoop({
    system: CHAT_SYSTEM,
    user: `${userPrompt(req, m, analysis, golden)}\n\nFeedback you already gave:\n${req.previousFeedback}\n\nConversation so far:\n${transcript}\n\nAnswer the user's last message, then call reply.`,
    tools: buildTools(req, m, analysis, golden, filter),
    final: { name: "reply", description: "Send your reply to the user. This ends your turn.", schema: ChatReply },
    maxSteps: 6,
    model: o.model,
    client: o.client,
  });
  const safety = last.role === "user" && PAIN.test(last.content) ? SAFETY_NOTE : null;
  return { message: run.output.message, followups: run.output.followups, safety, trace: run.trace, usage: run.usage };
}
