/**
 * Deterministic form analysis: keypoints in, reps and measured faults out.
 *
 * Nothing here calls a model. The agent reads these results through tools and
 * can only report what this code measured, which keeps feedback grounded and
 * makes every claim checkable in evals.
 */
import { FEATURES, type FaultRule, type FeatureId, type MovementGuide } from "./movements";
import { JOINT_INDEX, type CameraView, type Joint, type PoseSequence } from "./pose";

type Pt = { x: number; y: number };
type Series = (number | null)[];

const MIN_VIS = 0.5;

export interface Rep {
  /** 1-based, as shown to users. */
  n: number;
  start: number;
  bottom: number;
  end: number;
  features: Partial<Record<FeatureId, number>>;
}

export interface Quality {
  ok: boolean;
  durationS: number;
  frames: number;
  usableFraction: number;
  meanVisibility: number;
  side: "left" | "right";
  view: CameraView;
  issues: string[];
}

export interface FaultFinding {
  faultId: string;
  label: string;
  severity: FaultRule["severity"];
  feature: FeatureId;
  op: FaultRule["op"];
  threshold: number;
  /** 1-based rep numbers that broke the rule. */
  reps: number[];
  values: number[];
  worst: number;
  /** consistent: most reps. late_reps: only near the end of the set. occasional: scattered. */
  pattern: "consistent" | "late_reps" | "occasional";
}

export interface Trend {
  feature: FeatureId;
  first: number;
  last: number;
  change: number;
  note: string;
}

export interface FormAnalysis {
  movementId: string;
  quality: Quality;
  reps: Rep[];
  /** Median of each feature across reps. */
  summary: Partial<Record<FeatureId, number>>;
  faults: FaultFinding[];
  trends: Trend[];
  /** The primary angle over each rep, resampled to 40 points, for golden comparison. */
  repCurves: number[][];
}

// ---------- geometry ----------

export function angleAt(a: Pt, b: Pt, c: Pt): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** Angle of the segment from `lower` to `upper` away from straight up (image y points down). */
export function fromVertical(lower: Pt, upper: Pt): number {
  const dx = upper.x - lower.x;
  const dy = lower.y - upper.y;
  return (Math.atan2(Math.abs(dx), dy) * 180) / Math.PI;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
}

/** Fill short gaps by linear interpolation, then a centered moving average. */
function smooth(series: Series, window: number, maxGap: number): Series {
  const filled = [...series];
  let i = 0;
  while (i < filled.length) {
    if (filled[i] !== null) {
      i++;
      continue;
    }
    let j = i;
    while (j < filled.length && filled[j] === null) j++;
    const before = i > 0 ? filled[i - 1] : null;
    const after = j < filled.length ? filled[j] : null;
    if (j - i <= maxGap && before !== null && after !== null) {
      for (let k = i; k < j; k++) filled[k] = before + ((after - before) * (k - i + 1)) / (j - i + 1);
    }
    i = j;
  }
  const half = Math.floor(window / 2);
  return filled.map((v, idx) => {
    if (v === null) return null;
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, idx - half); k <= Math.min(filled.length - 1, idx + half); k++) {
      const w = filled[k];
      if (w !== null) {
        sum += w;
        n++;
      }
    }
    return sum / n;
  });
}

// ---------- per-frame signals ----------

interface Signals {
  knee: Series;
  minKnee: Series;
  hip: Series;
  elbow: Series;
  torsoLean: Series;
  hipDepth: Series;
  heelY: Series;
  hipLine: Series;
  kneeAnkleRatio: Series;
  /** Front view: hip height above the ankles as a share of leg length, ×180 so it behaves like an angle for rep counting. */
  hipHeight: Series;
  legLen: number;
  usable: boolean[];
}

function computeSignals(seq: PoseSequence, side: "l" | "r"): Signals {
  const point = (f: number, j: Joint): Pt | null => {
    const kp = seq.frames[f].kp[JOINT_INDEX[j]];
    if (!kp || kp[2] < MIN_VIS) return null;
    return { x: kp[0] * seq.width, y: kp[1] * seq.height };
  };
  const s = (name: string) => `${side}_${name}` as Joint;
  const n = seq.frames.length;
  const out: Signals = {
    knee: [],
    minKnee: [],
    hip: [],
    elbow: [],
    torsoLean: [],
    hipDepth: [],
    heelY: [],
    hipLine: [],
    kneeAnkleRatio: [],
    hipHeight: [],
    legLen: NaN,
    usable: [],
  };
  const legLens: number[] = [];
  for (let f = 0; f < n; f++) {
    const sh = point(f, s("shoulder"));
    const hip = point(f, s("hip"));
    const knee = point(f, s("knee"));
    const ankle = point(f, s("ankle"));
    const elbow = point(f, s("elbow"));
    const wrist = point(f, s("wrist"));
    const heel = point(f, s("heel"));
    out.usable.push(Boolean(sh && hip && knee && ankle));
    out.knee.push(hip && knee && ankle ? angleAt(hip, knee, ankle) : null);
    out.hip.push(sh && hip && knee ? angleAt(sh, hip, knee) : null);
    out.elbow.push(sh && elbow && wrist ? angleAt(sh, elbow, wrist) : null);
    out.torsoLean.push(sh && hip ? fromVertical(hip, sh) : null);
    if (hip && knee && ankle) legLens.push(dist(hip, knee) + dist(knee, ankle));
    out.hipDepth.push(hip && knee ? (hip.y - knee.y) / (dist(hip, knee) || 1) : null);
    out.heelY.push(heel ? heel.y : ankle ? ankle.y : null);
    if (sh && hip && ankle && Math.abs(ankle.x - sh.x) > 1) {
      // Signed deviation of the hip from the shoulder-ankle line. Positive = hip below the line (sag).
      const lineY = sh.y + ((ankle.y - sh.y) * (hip.x - sh.x)) / (ankle.x - sh.x);
      const deviation = 180 - angleAt(sh, hip, ankle);
      out.hipLine.push(hip.y > lineY ? deviation : -deviation);
    } else out.hipLine.push(null);

    const lk = point(f, "l_knee"), rk = point(f, "r_knee");
    const lh = point(f, "l_hip"), rh = point(f, "r_hip");
    const la = point(f, "l_ankle"), ra = point(f, "r_ankle");
    const kneeL = lh && lk && la ? angleAt(lh, lk, la) : null;
    const kneeR = rh && rk && ra ? angleAt(rh, rk, ra) : null;
    out.minKnee.push(kneeL === null ? kneeR : kneeR === null ? kneeL : Math.min(kneeL, kneeR));
    out.kneeAnkleRatio.push(lk && rk && la && ra && Math.abs(la.x - ra.x) > 1 ? Math.abs(lk.x - rk.x) / Math.abs(la.x - ra.x) : null);
    const hips = [lh, rh].filter(Boolean) as Pt[];
    const ankles = [la, ra].filter(Boolean) as Pt[];
    out.hipHeight.push(hips.length && ankles.length ? ankles.reduce((a, p) => a + p.y, 0) / ankles.length - hips.reduce((a, p) => a + p.y, 0) / hips.length : null);
  }
  // Segment lengths shrink on screen when a joint bends toward the camera, so use a high quantile (the standing length).
  out.legLen = quantile(legLens, 0.9);
  out.hipHeight = out.hipHeight.map((v) => (v === null || !(out.legLen > 0) ? null : (v / out.legLen) * 180));
  return out;
}

export function pickSide(seq: PoseSequence): "l" | "r" {
  const score = (side: "l" | "r") => {
    let sum = 0;
    for (const f of seq.frames)
      for (const j of ["shoulder", "hip", "knee", "ankle"]) sum += f.kp[JOINT_INDEX[`${side}_${j}` as Joint]]?.[2] ?? 0;
    return sum;
  };
  return score("l") >= score("r") ? "l" : "r";
}

function primarySeries(sig: Signals, m: MovementGuide, view: CameraView): Series {
  // From the front, knee and hip angles barely change as you squat (the bend points at the camera), so count reps by hip height.
  if (view === "front" && m.primary !== "elbow") return sig.hipHeight;
  switch (m.primary) {
    case "knee":
      return sig.knee;
    case "min_knee":
      return sig.minKnee;
    case "hip":
      return sig.hip;
    case "elbow":
      return sig.elbow;
  }
}

// ---------- reps ----------

function segmentReps(p: Series, minRom: number): { start: number; bottom: number; end: number }[] {
  const vals = p.filter((v): v is number => v !== null);
  if (vals.length < 5) return [];
  const top = quantile(vals, 0.95);
  const bottom = quantile(vals, 0.05);
  const range = top - bottom;
  if (range < minRom) return [];
  // Loose thresholds so a shallow, tired last rep still counts as a rep.
  const hi = top - 0.2 * range;
  const lo = bottom + 0.55 * range;
  const reps: { start: number; bottom: number; end: number }[] = [];
  let state: "waiting" | "up" | "down" = "waiting";
  let start = -1;
  for (let i = 0; i < p.length; i++) {
    const v = p[i];
    if (v === null) continue;
    if (state === "waiting" || state === "up") {
      if (v >= hi) {
        state = "up";
        start = i;
      } else if (state === "up" && v <= lo) state = "down";
    } else if (v >= hi) {
      let b = start;
      for (let k = start; k <= i; k++) if (p[k] !== null && p[k]! < (p[b] ?? Infinity)) b = k;
      reps.push({ start, bottom: b, end: i });
      state = "up";
      start = i;
    }
  }
  // Widen each rep to the local peaks on both sides, so the top position is included.
  for (let r = 0; r < reps.length; r++) {
    const rep = reps[r];
    const floor = r > 0 ? reps[r - 1].bottom : 0;
    while (rep.start > floor && p[rep.start - 1] !== null && p[rep.start - 1]! >= p[rep.start]!) rep.start--;
    const ceil = r < reps.length - 1 ? reps[r + 1].bottom : p.length - 1;
    while (rep.end < ceil && p[rep.end + 1] !== null && p[rep.end + 1]! >= p[rep.end]!) rep.end++;
  }
  return reps.filter((rep) => p[rep.bottom] !== null && Math.max(p[rep.start]!, p[rep.end]!) - p[rep.bottom]! >= minRom * 0.5);
}

function resample(xs: number[], n: number): number[] {
  if (xs.length === 1) return Array(n).fill(xs[0]);
  return Array.from({ length: n }, (_, i) => {
    const pos = (i * (xs.length - 1)) / (n - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, xs.length - 1);
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
  });
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function seriesIn(series: Series, a: number, b: number): number[] {
  return series.slice(a, b + 1).filter((v): v is number => v !== null);
}

function repFeatures(
  sig: Signals,
  primary: Series,
  r: { start: number; bottom: number; end: number },
  seq: PoseSequence,
  baselineHeel: number,
  view: CameraView,
): Partial<Record<FeatureId, number>> {
  const t = (i: number) => seq.frames[i].t / 1000;
  const f: Partial<Record<FeatureId, number>> = {};
  const set = (k: FeatureId, v: number | undefined | null) => {
    if (v !== undefined && v !== null && Number.isFinite(v)) f[k] = round(v);
  };
  const min = (s: Series) => (seriesIn(s, r.start, r.end).length ? Math.min(...seriesIn(s, r.start, r.end)) : null);
  const max = (s: Series) => (seriesIn(s, r.start, r.end).length ? Math.max(...seriesIn(s, r.start, r.end)) : null);
  set("min_knee_angle", primary === sig.minKnee ? min(sig.minKnee) : min(sig.knee));
  set("min_hip_angle", min(sig.hip));
  set("min_elbow_angle", min(sig.elbow));
  set("max_elbow_angle", max(sig.elbow));
  set("torso_lean_at_bottom", sig.torsoLean[r.bottom]);
  set("max_torso_lean", max(sig.torsoLean));
  set("hip_depth_at_bottom", sig.hipDepth[r.bottom]);
  const heelMin = min(sig.heelY);
  if (heelMin !== null && Number.isFinite(baselineHeel) && sig.legLen > 0) set("max_heel_lift", Math.max(0, (baselineHeel - heelMin) / sig.legLen));
  const line = seriesIn(sig.hipLine, r.start, r.end);
  if (line.length) {
    set("max_hip_sag", Math.max(0, ...line));
    set("max_hip_pike", Math.max(0, ...line.map((v) => -v)));
  }
  if (view === "front") set("knee_ankle_width_ratio", sig.kneeAnkleRatio[r.bottom]);
  set("descent_s", t(r.bottom) - t(r.start));
  set("ascent_s", t(r.end) - t(r.bottom));
  const pv = seriesIn(primary, r.start, r.end);
  if (pv.length) set("rom_deg", Math.max(...pv) - Math.min(...pv));
  return f;
}

// ---------- faults and trends ----------

const breaks = (v: number, rule: Pick<FaultRule, "op" | "threshold">) => (rule.op === ">" ? v > rule.threshold : v < rule.threshold);

export function detectFaults(reps: Rep[], movement: MovementGuide, view: CameraView): FaultFinding[] {
  const out: FaultFinding[] = [];
  const seen = view === "unknown" ? "side" : view;
  for (const rule of movement.faults) {
    // Each rule only runs on the camera angle that can see it (side unless stated).
    if ((rule.view ?? "side") !== seen) continue;
    const measured = reps.filter((r) => r.features[rule.feature] !== undefined);
    const bad = measured.filter((r) => breaks(r.features[rule.feature]!, rule));
    if (!bad.length) continue;
    const values = bad.map((r) => r.features[rule.feature]!);
    const n = measured.length;
    const firstHalfClean = bad.every((r) => r.n > Math.ceil(n / 2));
    const pattern = bad.length / n >= 0.6 ? "consistent" : n >= 4 && firstHalfClean ? "late_reps" : "occasional";
    out.push({
      faultId: rule.id,
      label: rule.label,
      severity: rule.severity,
      feature: rule.feature,
      op: rule.op,
      threshold: rule.threshold,
      reps: bad.map((r) => r.n),
      values,
      worst: rule.op === ">" ? Math.max(...values) : Math.min(...values),
      pattern,
    });
  }
  const rank = { major: 3, moderate: 2, minor: 1 } as const;
  return out.sort((a, b) => rank[b.severity] - rank[a.severity] || b.reps.length - a.reps.length);
}

function trends(reps: Rep[], movement: MovementGuide): Trend[] {
  if (reps.length < 4) return [];
  const out: Trend[] = [];
  const k = Math.max(1, Math.floor(reps.length / 3));
  const avg = (rs: Rep[], f: FeatureId) => {
    const v = rs.map((r) => r.features[f]).filter((x): x is number => x !== undefined);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
  };
  const watch: FeatureId[] = ["rom_deg", "ascent_s", ...movement.faults.map((f) => f.feature)];
  for (const f of [...new Set(watch)]) {
    if (!movement.features.includes(f)) continue;
    const first = avg(reps.slice(0, k), f);
    const last = avg(reps.slice(-k), f);
    if (!Number.isFinite(first) || !Number.isFinite(last)) continue;
    const change = last - first;
    const rel = Math.abs(change) / (Math.abs(first) || 1);
    if (rel < 0.15 && Math.abs(change) < 8) continue;
    out.push({
      feature: f,
      first: round(first),
      last: round(last),
      change: round(change),
      note: `${FEATURES[f]} Changed from ${round(first)} in the first ${k} rep(s) to ${round(last)} in the last ${k}.`,
    });
  }
  return out;
}

// ---------- entry point ----------

export function analyzeMovement(seq: PoseSequence, movement: MovementGuide): FormAnalysis {
  const sideKey = pickSide(seq);
  const raw = computeSignals(seq, sideKey);
  const win = Math.max(3, Math.round(seq.fps / 6) | 1);
  const gap = Math.round(seq.fps / 3);
  const sig: Signals = {
    ...raw,
    knee: smooth(raw.knee, win, gap),
    minKnee: smooth(raw.minKnee, win, gap),
    hip: smooth(raw.hip, win, gap),
    elbow: smooth(raw.elbow, win, gap),
    torsoLean: smooth(raw.torsoLean, win, gap),
    hipDepth: smooth(raw.hipDepth, win, gap),
    heelY: smooth(raw.heelY, win, gap),
    hipLine: smooth(raw.hipLine, win, gap),
    kneeAnkleRatio: smooth(raw.kneeAnkleRatio, win, gap),
    hipHeight: smooth(raw.hipHeight, win, gap),
  };
  const primary = primarySeries(sig, movement, seq.view);
  const segments = segmentReps(primary, movement.minRomDeg);

  // Heel baseline: median heel height while standing at the top of reps (or the first frames).
  const topFrames = segments.length ? segments.map((s) => s.start) : [0, 1, 2, 3, 4];
  const baselineHeel = median(topFrames.map((i) => sig.heelY[i]).filter((v): v is number => v !== null));

  const reps: Rep[] = segments.map((s, i) => {
    const all = repFeatures(sig, primary, s, seq, baselineHeel, seq.view);
    const features: Partial<Record<FeatureId, number>> = {};
    for (const k of movement.features) if (all[k] !== undefined) features[k] = all[k];
    return { n: i + 1, ...s, features };
  });

  const usableFraction = raw.usable.filter(Boolean).length / seq.frames.length;
  const visJoints = ["shoulder", "hip", "knee", "ankle"].map((j) => JOINT_INDEX[`${sideKey}_${j}` as Joint]);
  const vis = seq.frames.flatMap((f) => visJoints.map((i) => f.kp[i]?.[2] ?? 0));
  const meanVisibility = vis.reduce((a, b) => a + b, 0) / (vis.length || 1);
  const durationS = (seq.frames[seq.frames.length - 1].t - seq.frames[0].t) / 1000;
  const issues: string[] = [];
  if (usableFraction < 0.7) issues.push(`Key joints were hard to see in ${Math.round((1 - usableFraction) * 100)}% of frames. Keep the whole body in frame with good light.`);
  if (seq.view !== "unknown" && seq.view !== movement.view && !movement.faults.some((f) => f.view === seq.view))
    issues.push(`This movement is best filmed from the ${movement.view}; this clip is marked ${seq.view}.`);
  if (durationS < 2) issues.push("The clip is shorter than 2 seconds.");
  if (!reps.length) issues.push("No complete reps were found. Film at least two full reps from start to finish.");

  const summary: Partial<Record<FeatureId, number>> = {};
  for (const k of movement.features) {
    const v = reps.map((r) => r.features[k]).filter((x): x is number => x !== undefined);
    if (v.length) summary[k] = round(median(v));
  }

  const quality: Quality = {
    ok: usableFraction >= 0.7 && reps.length > 0 && durationS >= 2,
    durationS: round(durationS),
    frames: seq.frames.length,
    usableFraction: round(usableFraction),
    meanVisibility: round(meanVisibility),
    side: sideKey === "l" ? "left" : "right",
    view: seq.view,
    issues,
  };

  return {
    movementId: movement.id,
    quality,
    reps,
    summary,
    faults: quality.ok ? detectFaults(reps, movement, seq.view) : [],
    trends: quality.ok ? trends(reps, movement) : [],
    repCurves: reps.map((r) => resample(seriesIn(primary, r.start, r.end), 40).map((v) => round(v, 1))),
  };
}


/**
 * Side or front camera, from how wide the shoulders and hips look compared with the torso.
 * Side-on, the left and right joints overlap; from the front, they are far apart.
 */
export function detectView(seq: PoseSequence): "side" | "front" {
  const ratios: number[] = [];
  for (const f of seq.frames) {
    const g = (j: Joint) => {
      const k = f.kp[JOINT_INDEX[j]];
      return k && k[2] >= MIN_VIS ? { x: k[0] * seq.width, y: k[1] * seq.height } : null;
    };
    const ls = g("l_shoulder"), rs = g("r_shoulder"), lh = g("l_hip"), rh = g("r_hip");
    if (!ls || !rs || !lh || !rh) continue;
    const torso = (dist(ls, lh) + dist(rs, rh)) / 2;
    if (torso > 0) ratios.push((Math.abs(ls.x - rs.x) + Math.abs(lh.x - rh.x)) / 2 / torso);
  }
  return ratios.length && median(ratios) > 0.35 ? "front" : "side";
}
