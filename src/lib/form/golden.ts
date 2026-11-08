/**
 * Golden set: clips of good form that define "normal" for each movement, plus
 * labeled clips (good or with known faults) that we evaluate against.
 *
 * Raw keypoints from two people can't be compared directly: body size, camera
 * distance and speed all differ. So a reference stores, per movement:
 *   1. the spread of each per-rep feature (joint angles and ratios are
 *      scale-free), and
 *   2. the average shape of the main joint angle over one rep, time-normalized,
 *      compared with dynamic time warping so tempo differences don't count.
 */
import { z } from "zod";
import { analyzeMovement, median, quantile, type FormAnalysis } from "./analyze";
import { FEATURES, type FeatureId, type MovementGuide } from "./movements";
import { PoseSequence } from "./pose";

/** One recorded clip after keypoint extraction (scripts/form/extract_pose.py writes these). */
export const LabeledClip = z.object({
  id: z.string(),
  movementId: z.string(),
  exerciseId: z.string().optional(),
  /** "good" clips build the reference. Every clip is used for evals. */
  label: z.enum(["good", "faulty"]),
  /** Fault ids (from movements.ts) a human rater saw. Empty for good clips. */
  faults: z.array(z.string()).default([]),
  /** Optional cause the clip was recorded to show, e.g. "fatigue". Used for diagnosis evals. */
  cause: z.string().optional(),
  rater: z.string().optional(),
  notes: z.string().optional(),
  pose: PoseSequence,
});
export type LabeledClip = z.infer<typeof LabeledClip>;

const Stat = z.object({ mean: z.number(), sd: z.number(), p10: z.number(), p90: z.number(), n: z.number().int() });

export const GoldenReference = z.object({
  version: z.literal(1),
  movementId: z.string(),
  builtAt: z.string(),
  clipIds: z.array(z.string()),
  reps: z.number().int(),
  features: z.record(z.string(), Stat),
  /** Mean primary-angle curve over one rep (40 points), and the typical DTW distance of golden reps to it. */
  template: z.array(z.number()),
  templateSpread: z.number(),
});
export type GoldenReference = z.infer<typeof GoldenReference>;

export function buildReference(movement: MovementGuide, clips: LabeledClip[], builtAt = new Date().toISOString()): GoldenReference {
  const good = clips.filter((c) => c.movementId === movement.id && c.label === "good");
  if (!good.length) throw new Error(`No good clips for ${movement.id}.`);
  const analyses = good.map((c) => analyzeMovement(c.pose, movement)).filter((a) => a.quality.ok);
  const reps = analyses.flatMap((a) => a.reps);
  if (!reps.length) throw new Error(`No usable reps in the good clips for ${movement.id}.`);

  const features: GoldenReference["features"] = {};
  for (const f of movement.features) {
    const v = reps.map((r) => r.features[f]).filter((x): x is number => x !== undefined);
    if (v.length < 2) continue;
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
    features[f] = { mean: r2(mean), sd: r2(sd), p10: r2(quantile(v, 0.1)), p90: r2(quantile(v, 0.9)), n: v.length };
  }

  const curves = analyses.flatMap((a) => a.repCurves);
  const template = curves[0].map((_, i) => r2(curves.reduce((a, c) => a + c[i], 0) / curves.length));
  const spread = median(curves.map((c) => dtw(c, template)));
  return {
    version: 1,
    movementId: movement.id,
    builtAt,
    clipIds: good.map((c) => c.id),
    reps: reps.length,
    features,
    template,
    templateSpread: r2(Math.max(spread, 1)),
  };
}

export interface GoldenDeviation {
  feature: FeatureId;
  description: string;
  user: number;
  goldenMean: number;
  goldenRange: [number, number];
  z: number;
  direction: "higher" | "lower";
}

export interface GoldenComparison {
  available: boolean;
  goldenClips: number;
  goldenReps: number;
  deviations: GoldenDeviation[];
  /** 0–100 per rep: how closely the main joint's motion matches the golden shape (100 = typical golden rep). */
  shapeSimilarity: number[];
  note: string;
}

/** Features count as different from golden when |z| ≥ 2 and the value is outside the golden 10th–90th percentile. */
export function compareToGolden(analysis: FormAnalysis, ref: GoldenReference | undefined): GoldenComparison {
  if (!ref) {
    return {
      available: false,
      goldenClips: 0,
      goldenReps: 0,
      deviations: [],
      shapeSimilarity: [],
      note: "No golden reference has been built for this movement yet, so only the rule-based checks apply.",
    };
  }
  const deviations: GoldenDeviation[] = [];
  for (const [f, stat] of Object.entries(ref.features)) {
    const user = analysis.summary[f as FeatureId];
    if (user === undefined) continue;
    // Floor the spread so a very consistent golden set doesn't flag tiny differences.
    const sd = Math.max(stat.sd, Math.abs(stat.mean) * 0.05, 0.02);
    const z = (user - stat.mean) / sd;
    if (Math.abs(z) >= 2 && (user < stat.p10 || user > stat.p90)) {
      deviations.push({
        feature: f as FeatureId,
        description: FEATURES[f as FeatureId],
        user,
        goldenMean: stat.mean,
        goldenRange: [stat.p10, stat.p90],
        z: r2(z),
        direction: z > 0 ? "higher" : "lower",
      });
    }
  }
  deviations.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  const shapeSimilarity = analysis.repCurves.map((c) => Math.round(100 * Math.exp(-Math.max(0, dtw(c, ref.template) - ref.templateSpread) / (2 * ref.templateSpread))));
  return {
    available: true,
    goldenClips: ref.clipIds.length,
    goldenReps: ref.reps,
    deviations,
    shapeSimilarity,
    note: "Compared with the golden set using per-rep medians. Deviations are differences from the golden examples, not faults by themselves.",
  };
}

/** Dynamic time warping distance (mean absolute difference along the best alignment), with a ±25% band. */
export function dtw(a: number[], b: number[]): number {
  const n = a.length;
  const m = b.length;
  const band = Math.max(2, Math.ceil(Math.max(n, m) * 0.25));
  const INF = Number.POSITIVE_INFINITY;
  const D = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(INF));
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  D[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    const center = Math.round((i * m) / n);
    for (let j = Math.max(1, center - band); j <= Math.min(m, center + band); j++) {
      const cost = Math.abs(a[i - 1] - b[j - 1]);
      const options: [number, number][] = [
        [D[i - 1][j], L[i - 1][j]],
        [D[i][j - 1], L[i][j - 1]],
        [D[i - 1][j - 1], L[i - 1][j - 1]],
      ];
      const [best, len] = options.reduce((x, y) => (y[0] < x[0] ? y : x));
      D[i][j] = best + cost;
      L[i][j] = len + 1;
    }
  }
  return D[n][m] / (L[n][m] || 1);
}

const r2 = (v: number) => Math.round(v * 100) / 100;
