/**
 * Synthetic pose clips for tests and harness smoke checks. Simple 2D stick
 * figures with known angles, so we can check that rep counting and fault
 * rules find exactly what was put in.
 *
 * Synthetic data is for testing the code only. Never report it as evaluation
 * evidence or show it as a real user's clip.
 */
import { JOINTS, type Joint, type PoseFrame, type PoseSequence } from "./pose";

type P = { x: number; y: number }; // y up, 0..1

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}

const rad = (d: number) => (d * Math.PI) / 180;

function frame(t: number, pts: Partial<Record<Joint, P>>, noise: () => number, farVis = 0.6, amp = 0.0015): PoseFrame {
  return {
    t,
    kp: JOINTS.map((j) => {
      const p = pts[j];
      if (!p) return null;
      const vis = j.startsWith("r_") ? farVis : 0.95;
      return [p.x + noise() * amp, 1 - p.y + noise() * amp, vis];
    }),
  };
}

/** Depth envelope: 0 standing, 1 at the bottom. Each rep is `repS` seconds with a short pause between reps. */
function envelope(t: number, repS: number, pauseS: number, reps: number): { d: number; rep: number } {
  const cycle = repS + pauseS;
  const rep = Math.floor((t - pauseS) / cycle);
  if (t < pauseS || rep >= reps) return { d: 0, rep: Math.min(Math.max(rep, 0), reps - 1) };
  const phase = (t - pauseS - rep * cycle) / repS;
  return phase > 1 ? { d: 0, rep } : { d: (1 - Math.cos(2 * Math.PI * phase)) / 2, rep };
}

export interface SquatOptions {
  reps?: number;
  fps?: number;
  /** Knee angle at the bottom of each rep. ~85 = deep, 120 = shallow. */
  bottomKneeDeg?: number;
  /** Torso angle from vertical at the bottom. */
  leanDeg?: number;
  /** Heel rise at the bottom, as a fraction of leg length. */
  heelLift?: number;
  /** Extra knee angle (shallower) added linearly over the last third of the set. */
  fatigueDeg?: number;
  repS?: number;
  seed?: number;
}

export function syntheticSquat(o: SquatOptions = {}): PoseSequence {
  const { reps = 6, fps = 30, bottomKneeDeg = 85, leanDeg = 40, heelLift = 0, fatigueDeg = 0, repS = 2.4, seed = 1 } = o;
  const pause = 0.6;
  const noise = rng(seed);
  const shin = 0.22, thigh = 0.22, torso = 0.28;
  const A: P = { x: 0.45, y: 0.12 };
  const total = pause + reps * (repS + pause);
  const frames: PoseFrame[] = [];
  for (let i = 0; i <= Math.round(total * fps); i++) {
    const t = i / fps;
    const { d, rep } = envelope(t, repS, pause, reps);
    const lateStart = Math.floor((reps * 2) / 3);
    const extra = rep >= lateStart ? (fatigueDeg * (rep - lateStart + 1)) / (reps - lateStart) : 0;
    const flex = (180 - (bottomKneeDeg + extra)) * d;
    const phiS = rad(0.4 * flex), phiT = rad(0.6 * flex), lam = rad(leanDeg * d);
    const K = { x: A.x + shin * Math.sin(phiS), y: A.y + shin * Math.cos(phiS) };
    const H = { x: K.x - thigh * Math.sin(phiT), y: K.y + thigh * Math.cos(phiT) };
    const S = { x: H.x + torso * Math.sin(lam), y: H.y + torso * Math.cos(lam) };
    const E = { x: S.x + 0.1, y: S.y - 0.06 };
    const W = { x: E.x + 0.06, y: E.y + 0.06 };
    const heel = { x: A.x - 0.03, y: A.y - 0.04 + heelLift * (shin + thigh) * d };
    const toe = { x: A.x + 0.07, y: A.y - 0.05 };
    const nose = { x: S.x + 0.04, y: S.y + 0.1 };
    const side = (s: "l" | "r") => ({
      [`${s}_shoulder`]: S, [`${s}_elbow`]: E, [`${s}_wrist`]: W, [`${s}_hip`]: H, [`${s}_knee`]: K,
      [`${s}_ankle`]: A, [`${s}_heel`]: heel, [`${s}_toe`]: toe,
    }) as Partial<Record<Joint, P>>;
    frames.push(frame(Math.round(t * 1000), { nose, ...side("l"), ...side("r") }, noise));
  }
  return { version: 1, source: "synthetic", fps, width: 1000, height: 1000, view: "side", frames };
}

export interface PushUpOptions {
  reps?: number;
  fps?: number;
  /** Elbow angle at the bottom. ~80 = full depth, 120 = partial. */
  bottomElbowDeg?: number;
  /** Hip drop below the shoulder-ankle line, in degrees. Negative = pike. */
  sagDeg?: number;
  /** Extra sag added over the last third of the set. */
  fatigueSagDeg?: number;
  seed?: number;
}

export function syntheticPushUp(o: PushUpOptions = {}): PoseSequence {
  const { reps = 6, fps = 30, bottomElbowDeg = 80, sagDeg = 3, fatigueSagDeg = 0, seed = 2 } = o;
  const repS = 2, pause = 0.5;
  const noise = rng(seed);
  const body = 0.6, upper = 0.15, fore = 0.15;
  const A: P = { x: 0.85, y: 0.12 };
  const at = (alpha: number): P => ({ x: A.x - body * Math.cos(alpha), y: A.y + body * Math.sin(alpha) });
  const topAlpha = Math.asin(0.295 / body);
  const W: P = { x: at(topAlpha).x, y: 0.12 };
  const solveAlpha = (target: number) => {
    let lo = 0.05, hi = topAlpha;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      const s = at(mid);
      if (Math.hypot(s.x - W.x, s.y - W.y) < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const total = pause + reps * (repS + pause);
  const frames: PoseFrame[] = [];
  for (let i = 0; i <= Math.round(total * fps); i++) {
    const t = i / fps;
    const { d, rep } = envelope(t, repS, pause, reps);
    const elbowDeg = 175 - (175 - bottomElbowDeg) * d;
    const reach = Math.sqrt(upper ** 2 + fore ** 2 - 2 * upper * fore * Math.cos(rad(elbowDeg)));
    const S = at(solveAlpha(reach));
    const alpha = Math.atan2(S.y - A.y, A.x - S.x);
    const lateStart = Math.floor((reps * 2) / 3);
    const sag = sagDeg + (rep >= lateStart ? (fatigueSagDeg * (rep - lateStart + 1)) / (reps - lateStart) : 0);
    const offset = (body / 2) * Math.tan(rad(sag / 2));
    const mid = { x: (S.x + A.x) / 2, y: (S.y + A.y) / 2 };
    const H = { x: mid.x - Math.sin(alpha) * offset, y: mid.y - Math.cos(alpha) * offset };
    const K = { x: (H.x + A.x) / 2, y: (H.y + A.y) / 2 };
    // Elbow: intersection of the two arm circles, on the side toward the feet.
    const dx = W.x - S.x, dy = W.y - S.y, dd = Math.hypot(dx, dy);
    const a = (upper ** 2 - fore ** 2 + dd ** 2) / (2 * dd);
    const h = Math.sqrt(Math.max(0, upper ** 2 - a ** 2));
    const E = { x: S.x + (a * dx) / dd + (h * dy) / dd, y: S.y + (a * dy) / dd - (h * dx) / dd };
    const nose = { x: S.x - 0.08, y: S.y + 0.02 };
    const side = (s: "l" | "r") => ({
      [`${s}_shoulder`]: S, [`${s}_elbow`]: E, [`${s}_wrist`]: W, [`${s}_hip`]: H, [`${s}_knee`]: K,
      [`${s}_ankle`]: A, [`${s}_heel`]: { x: A.x + 0.02, y: A.y + 0.03 }, [`${s}_toe`]: { x: A.x - 0.01, y: A.y - 0.02 },
    }) as Partial<Record<Joint, P>>;
    frames.push(frame(Math.round(t * 1000), { nose, ...side("l"), ...side("r") }, noise));
  }
  return { version: 1, source: "synthetic", fps, width: 1000, height: 1000, view: "side", frames };
}
