/**
 * Form-coach evaluation on labeled clips.
 *
 *   npm run form:eval                        # rule checks + rule-based coach
 *   npm run form:eval -- --coach agent       # also run the AI coach (needs LLM_API_KEY)
 *
 * Metric A, fault detection: per fault id, precision and recall of the
 *   measured faults against the human labels.
 * Metric B, grounded feedback: precision and recall of the faults the coach
 *   actually reports (after the gate), plus how often the gate dropped claims.
 * Metric C, diagnosis: for clips recorded to show a cause, how often the
 *   coach's top finding names that cause.
 *
 * Good clips that were used to build the golden reference are still scored
 * on the rule checks, but held out of the golden comparison: the reference is
 * rebuilt without the clip under test (leave-one-out).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeMovement } from "../../src/lib/form/analyze";
import { coachForm } from "../../src/lib/form/coach";
import { buildReference, type GoldenReference, type LabeledClip } from "../../src/lib/form/golden";
import { MOVEMENTS } from "../../src/lib/form/movements";
import type { FitnessProfile } from "../../src/lib/schemas";
import { loadClips } from "./clips";

try {
  process.loadEnvFile?.(".env.local");
} catch {
  /* no env file: rule-based only */
}

const coachMode = process.argv.includes("--coach") ? process.argv[process.argv.indexOf("--coach") + 1] : "rule_based";

const profile: FitnessProfile = {
  version: 1,
  goals: ["strength"],
  targetMuscles: [],
  experience: "intermediate",
  workoutTypes: ["gym", "home"],
  equipment: ["dumbbells", "kettlebell", "barbell", "bench", "squat_rack", "resistance_bands"],
  sessionMinutes: 45,
  frequencyPerWeek: 3,
  preferredDays: ["mon", "wed", "fri"],
  preferredTimes: ["evening"],
  avoidTags: [],
  avoidExerciseIds: [],
  avoidNotes: "",
  limitations: "",
  updatedAt: "2026-11-01T00:00:00Z",
};

type Counts = { tp: number; fp: number; fn: number };
const add = (m: Map<string, Counts>, k: string, f: keyof Counts) => {
  const c = m.get(k) ?? { tp: 0, fp: 0, fn: 0 };
  c[f]++;
  m.set(k, c);
};
const score = (truth: string[], predicted: string[], into: Map<string, Counts>) => {
  for (const p of predicted) add(into, p, truth.includes(p) ? "tp" : "fp");
  for (const t of truth) if (!predicted.includes(t)) add(into, t, "fn");
};
const pr = (c: Counts) => ({
  ...c,
  precision: c.tp + c.fp ? +(c.tp / (c.tp + c.fp)).toFixed(2) : null,
  recall: c.tp + c.fn ? +(c.tp / (c.tp + c.fn)).toFixed(2) : null,
});

function leaveOneOut(clip: LabeledClip, all: LabeledClip[]): GoldenReference | undefined {
  const m = MOVEMENTS[clip.movementId];
  const good = all.filter((c) => c.movementId === clip.movementId && c.label === "good" && c.id !== clip.id);
  if (!m || good.length < 2) return undefined;
  try {
    return buildReference(m, good);
  } catch {
    return undefined;
  }
}

async function main() {
  const clips = loadClips();
  if (!clips.length) {
    console.log("No clips in data/form/clips yet. Record some and run scripts/form/extract_pose.py first.");
    return;
  }
  const detection = new Map<string, Counts>();
  const reported = new Map<string, Counts>();
  const rows: unknown[] = [];
  let unusable = 0;
  let dropped = 0;
  let causeTotal = 0;
  let causeHit = 0;

  for (const clip of clips) {
    const m = MOVEMENTS[clip.movementId];
    if (!m) continue;
    const analysis = analyzeMovement(clip.pose, m);
    if (!analysis.quality.ok) unusable++;
    const measured = analysis.faults.map((f) => f.faultId);
    score(clip.faults, measured, detection);

    const ref = leaveOneOut(clip, clips);
    const res = await coachForm(
      { movementId: m.id, exerciseId: clip.exerciseId, pose: clip.pose, set: {}, profile, formHistory: [], log: [], now: { date: "2026-11-08" } },
      { ruleBased: coachMode !== "agent", references: ref ? { [m.id]: ref } : {} },
    );
    const said = res.feedback.findings.map((f) => f.faultId);
    score(clip.faults, said, reported);
    dropped += res.dropped.length;
    const topCause = res.feedback.findings[0]?.cause?.id ?? null;
    if (clip.cause) {
      causeTotal++;
      if (topCause === clip.cause) causeHit++;
    }
    rows.push({
      clip: clip.id,
      movement: m.id,
      label: clip.label,
      truth: clip.faults,
      quality: analysis.quality.ok,
      reps: analysis.reps.length,
      measured,
      reported: said,
      expectedCause: clip.cause ?? null,
      topCause,
      generatedBy: res.generatedBy,
      dropped: res.dropped,
      tokens: res.usage ? res.usage.inputTokens + res.usage.outputTokens : 0,
    });
  }

  const summary = {
    clips: clips.length,
    unusableClips: unusable,
    coach: coachMode,
    detection: Object.fromEntries([...detection].map(([k, v]) => [k, pr(v)])),
    reported: Object.fromEntries([...reported].map(([k, v]) => [k, pr(v)])),
    diagnosis: causeTotal ? { clips: causeTotal, correct: causeHit, accuracy: +(causeHit / causeTotal).toFixed(2) } : null,
    gateDrops: dropped,
  };
  console.log(JSON.stringify(summary, null, 2));
  const dir = join(process.cwd(), "evals", "results", "runs");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_form_${coachMode}.json`);
  writeFileSync(file, JSON.stringify({ summary, rows }, null, 2));
  console.log(`Wrote ${file}`);
}

main();
