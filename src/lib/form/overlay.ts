/**
 * Drawing the tracked skeleton on top of a video frame. Shared by the live
 * player and the annotated-video export.
 */
import { angleAt } from "./analyze";
import type { MovementGuide } from "./movements";
import { JOINT_INDEX, type CameraView, type Joint, type PoseFrame, type PoseSequence } from "./pose";

const BONES: [Joint, Joint][] = [
  ["l_shoulder", "r_shoulder"],
  ["l_hip", "r_hip"],
  ["l_shoulder", "l_elbow"],
  ["l_elbow", "l_wrist"],
  ["r_shoulder", "r_elbow"],
  ["r_elbow", "r_wrist"],
  ["l_shoulder", "l_hip"],
  ["r_shoulder", "r_hip"],
  ["l_hip", "l_knee"],
  ["l_knee", "l_ankle"],
  ["r_hip", "r_knee"],
  ["r_knee", "r_ankle"],
  ["l_ankle", "l_heel"],
  ["l_heel", "l_toe"],
  ["l_ankle", "l_toe"],
  ["r_ankle", "r_heel"],
  ["r_heel", "r_toe"],
  ["r_ankle", "r_toe"],
];

const PRIMARY_JOINTS: Record<MovementGuide["primary"], [string, string, string, string]> = {
  knee: ["hip", "knee", "ankle", "Knee"],
  min_knee: ["hip", "knee", "ankle", "Knee"],
  hip: ["shoulder", "hip", "knee", "Hip"],
  elbow: ["shoulder", "elbow", "wrist", "Elbow"],
};

export interface OverlayRep {
  n: number;
  startMs: number;
  bottomMs?: number;
  endMs: number;
  /** The angle this rep was filmed from, if it differs across the clip. */
  view?: CameraView;
  faults: string[];
}

export interface OverlayOptions {
  side: "left" | "right";
  primary: MovementGuide["primary"];
  reps: OverlayRep[];
  faultLabels: Record<string, string>;
  /** From the front, the live label shows knee width instead of a joint angle. */
  view?: CameraView;
  /** Rep numbers the user selected; highlighted with a ring. */
  focusRep?: number | null;
}

/** Frame nearest to `ms` (frames are sorted by t). */
export function frameAt(seq: PoseSequence, ms: number): PoseFrame | null {
  const f = seq.frames;
  if (!f.length) return null;
  let lo = 0, hi = f.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (f[mid].t < ms) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(f[lo - 1].t - ms) < Math.abs(f[lo].t - ms)) lo--;
  return Math.abs(f[lo].t - ms) > 400 ? null : f[lo];
}

const COLORS = { ok: "#4a8ed4", bad: "#ee5d3b", joint: "#fffdf9", text: "#1f1a16" };

/**
 * Draw onto `ctx` where the video occupies the rectangle (x, y, w, h) in canvas pixels.
 * `scale` sizes lines and text (1 for an on-screen overlay, larger for full-resolution exports).
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  seq: PoseSequence,
  ms: number,
  rect: { x: number; y: number; w: number; h: number },
  o: OverlayOptions,
  scale = 1,
) {
  const frame = frameAt(seq, ms);
  const rep = o.reps.find((r) => ms >= r.startMs && ms <= r.endMs) ?? null;
  const bad = Boolean(rep?.faults.length);
  const color = bad ? COLORS.bad : COLORS.ok;

  if (frame) {
    const p = (j: Joint) => {
      const k = frame.kp[JOINT_INDEX[j]];
      return k && k[2] >= 0.5 ? { x: rect.x + k[0] * rect.w, y: rect.y + k[1] * rect.h } : null;
    };
    ctx.lineCap = "round";
    ctx.lineWidth = 4 * scale;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.9;
    for (const [a, b] of BONES) {
      const pa = p(a), pb = p(b);
      if (!pa || !pb) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const j of Object.keys(JOINT_INDEX) as Joint[]) {
      const pt = p(j);
      if (!pt || j === "nose") continue;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4.5 * scale, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.joint;
      ctx.fill();
      ctx.lineWidth = 2 * scale;
      ctx.strokeStyle = color;
      ctx.stroke();
    }

    const view = rep?.view ?? o.view;
    const lk = p("l_knee"), rk = p("r_knee"), la = p("l_ankle"), ra = p("r_ankle");
    if (view === "front" && o.primary !== "elbow") {
      // Live knee width vs. feet width: below ~85% means the knees are caving in.
      if (rep && lk && rk && la && ra && Math.abs(la.x - ra.x) > 1) {
        const pct = Math.round((Math.abs(lk.x - rk.x) / Math.abs(la.x - ra.x)) * 100);
        tag(ctx, `Knees ${pct}% of feet width`, Math.min(lk.x, rk.x), (lk.y + rk.y) / 2 - 18 * scale, color, scale);
      }
    }
    // Live angle at the movement's main joint (side view).
    const s = o.side === "left" ? "l" : "r";
    const [a, b, c, label] = PRIMARY_JOINTS[o.primary];
    const pa = p(`${s}_${a}` as Joint), pb = p(`${s}_${b}` as Joint), pc = p(`${s}_${c}` as Joint);
    if (view !== "front" && pa && pb && pc) {
      const deg = Math.round(angleAt(pa, pb, pc));
      tag(ctx, `${label} ${deg}°`, pb.x + 14 * scale, pb.y - 14 * scale, color, scale);
    }
  }

  // Rep counter and fault label, top-left.
  const done = o.reps.filter((r) => r.endMs <= ms).length;
  const head = rep ? `Rep ${rep.n} of ${o.reps.length}` : o.reps.length ? `${done} of ${o.reps.length} reps` : "Tracking";
  tag(ctx, head, rect.x + 12 * scale, rect.y + 26 * scale, COLORS.text, scale, "#fffdf9");
  if (rep && bad) {
    tag(ctx, rep.faults.map((f) => o.faultLabels[f] ?? f).join(" · "), rect.x + 12 * scale, rect.y + 56 * scale, "#fffdf9", scale, COLORS.bad);
  }
}

function tag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fg: string, scale: number, bg = "rgba(255,253,249,0.92)") {
  ctx.font = `600 ${13 * scale}px ui-sans-serif, system-ui, sans-serif`;
  const w = ctx.measureText(text).width;
  const padX = 8 * scale, h = 22 * scale;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, y - h + 6 * scale, w + padX * 2, h, 11 * scale);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.fillText(text, x + padX, y);
}
