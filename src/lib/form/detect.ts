/**
 * Guess which movement a clip shows, from how the joints move. Only covers
 * the movements in movements.ts, and the UI always asks the user to confirm.
 *
 *   body horizontal                    → push-up
 *   feet far apart front-to-back       → lunge / split squat
 *   big knee bend                      → squat
 *   big hip bend with little knee bend → hinge
 */
import { analyzeMovement, angleAt, detectView, fromVertical, median, pickSide } from "./analyze";
import { MOVEMENTS } from "./movements";
import { JOINT_INDEX, type Joint, type PoseSequence } from "./pose";

export interface MovementGuess {
  movementId: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
  reps: number;
}

export function detectMovement(seq: PoseSequence): MovementGuess {
  const side = pickSide(seq);
  const pt = (f: number, j: string) => {
    const k = seq.frames[f].kp[JOINT_INDEX[j as Joint]];
    return k && k[2] >= 0.5 ? { x: k[0] * seq.width, y: k[1] * seq.height } : null;
  };
  const torso: number[] = [];
  const spread: number[] = [];
  const kneeAngles: number[] = [];
  for (let f = 0; f < seq.frames.length; f++) {
    const sh = pt(f, `${side}_shoulder`), hip = pt(f, `${side}_hip`), knee = pt(f, `${side}_knee`), ankle = pt(f, `${side}_ankle`);
    if (sh && hip) torso.push(fromVertical(hip, sh));
    if (hip && knee && ankle) kneeAngles.push(angleAt(hip, knee, ankle));
    const la = pt(f, "l_ankle"), ra = pt(f, "r_ankle"), lh = pt(f, "l_hip"), lk = pt(f, "l_knee");
    if (la && ra && lh && lk) {
      const leg = Math.hypot(lh.x - lk.x, lh.y - lk.y) + Math.hypot(lk.x - la.x, lk.y - la.y);
      spread.push(Math.abs(la.x - ra.x) / (leg || 1));
    }
  }
  if (torso.length < seq.frames.length * 0.5) {
    return { movementId: null, confidence: "low", reason: "I couldn't see the body clearly enough to tell.", reps: 0 };
  }

  const reps = (id: string) => analyzeMovement(seq, MOVEMENTS[id]);
  if (median(torso) > 55) {
    const a = reps("push_up");
    return {
      movementId: "push_up",
      confidence: a.reps.length ? "high" : "medium",
      reason: `Your body is close to horizontal${a.reps.length ? ` and your elbows bend and straighten ${a.reps.length} times` : ""}.`,
      reps: a.reps.length,
    };
  }
  const front = detectView(seq) === "front";
  if (front) {
    // From the front only the squat is supported: count reps by hip height.
    const a = reps("squat");
    return a.reps.length
      ? { movementId: "squat", confidence: "medium", reason: "You're facing the camera and your hips drop and rise like a squat.", reps: a.reps.length }
      : { movementId: null, confidence: "low", reason: "You're facing the camera, and I couldn't make out the movement from this angle.", reps: 0 };
  }
  if (spread.length && median(spread) > 0.45) {
    const a = reps("lunge");
    return { movementId: "lunge", confidence: a.reps.length ? "high" : "medium", reason: "Your feet are in a split stance, one in front of the other.", reps: a.reps.length };
  }
  const squat = reps("squat");
  const hinge = reps("hinge");
  const kneeRom = squat.summary.rom_deg ?? 0;
  const hipRom = hinge.summary.rom_deg ?? 0;
  if (kneeRom >= 50 && squat.reps.length) {
    return { movementId: "squat", confidence: "high", reason: `Your knees bend about ${Math.round(kneeRom)}° each rep while you stay upright-ish.`, reps: squat.reps.length };
  }
  if (hipRom >= 35 && hinge.reps.length && kneeRom < 45) {
    return { movementId: "hinge", confidence: "high", reason: `Your hips bend about ${Math.round(hipRom)}° while your knees stay fairly straight.`, reps: hinge.reps.length };
  }
  if (squat.reps.length || hinge.reps.length) {
    const isSquat = kneeRom >= hipRom;
    return {
      movementId: isSquat ? "squat" : "hinge",
      confidence: "low",
      reason: "The movement is small or unclear, so this is a rough guess.",
      reps: isSquat ? squat.reps.length : hinge.reps.length,
    };
  }
  const kneeRange = kneeAngles.length ? Math.max(...kneeAngles) - Math.min(...kneeAngles) : 0;
  return { movementId: null, confidence: "low", reason: kneeRange < 15 ? "I didn't see any repeated movement." : "I couldn't match this to a movement I know.", reps: 0 };
}
