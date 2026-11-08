/**
 * Pose data: one canonical keypoint format for every source.
 *
 * MediaPipe BlazePose (33 landmarks) and YOLO pose (COCO, 17 keypoints) are
 * both converted into the 17 named joints below, so the analysis code, the
 * golden references and the evals never care which model produced the data.
 * Coordinates are normalized to the frame (0..1, y pointing down), exactly as
 * both models return them. `width` and `height` turn them back into pixels so
 * angles are not distorted by the aspect ratio.
 */
import { z } from "zod";

export const JOINTS = [
  "nose",
  "l_shoulder",
  "r_shoulder",
  "l_elbow",
  "r_elbow",
  "l_wrist",
  "r_wrist",
  "l_hip",
  "r_hip",
  "l_knee",
  "r_knee",
  "l_ankle",
  "r_ankle",
  "l_heel",
  "r_heel",
  "l_toe",
  "r_toe",
] as const;
export type Joint = (typeof JOINTS)[number];
export const JOINT_INDEX = Object.fromEntries(JOINTS.map((j, i) => [j, i])) as Record<Joint, number>;

/** [x, y, visibility], all 0..1. `null` when the model gives no point. */
export const Keypoint = z.tuple([z.number(), z.number(), z.number().min(0).max(1)]);
export type Keypoint = z.infer<typeof Keypoint>;

export const PoseFrame = z.object({
  /** Milliseconds since the start of the clip. */
  t: z.number().min(0),
  /** One entry per JOINTS item, in order. */
  kp: z.array(Keypoint.nullable()).length(JOINTS.length),
});
export type PoseFrame = z.infer<typeof PoseFrame>;

export const CAMERA_VIEWS = ["side", "front", "unknown"] as const;
export const CameraView = z.enum(CAMERA_VIEWS);
export type CameraView = z.infer<typeof CameraView>;

export const PoseSequence = z.object({
  version: z.literal(1),
  source: z.enum(["mediapipe_blazepose", "yolo_pose", "synthetic"]),
  fps: z.number().positive().max(240),
  width: z.number().positive(),
  height: z.number().positive(),
  view: CameraView,
  /** Up to ~2 minutes at 30 fps. Downsample longer clips before sending. */
  frames: z.array(PoseFrame).min(1).max(4000),
});
export type PoseSequence = z.infer<typeof PoseSequence>;

/** BlazePose landmark index for each canonical joint. */
const BLAZEPOSE: Record<Joint, number> = {
  nose: 0,
  l_shoulder: 11,
  r_shoulder: 12,
  l_elbow: 13,
  r_elbow: 14,
  l_wrist: 15,
  r_wrist: 16,
  l_hip: 23,
  r_hip: 24,
  l_knee: 25,
  r_knee: 26,
  l_ankle: 27,
  r_ankle: 28,
  l_heel: 29,
  r_heel: 30,
  l_toe: 31,
  r_toe: 32,
};

/** COCO-17 index (YOLO pose). COCO has no heel or toe points. */
const COCO17: Partial<Record<Joint, number>> = {
  nose: 0,
  l_shoulder: 5,
  r_shoulder: 6,
  l_elbow: 7,
  r_elbow: 8,
  l_wrist: 9,
  r_wrist: 10,
  l_hip: 11,
  r_hip: 12,
  l_knee: 13,
  r_knee: 14,
  l_ankle: 15,
  r_ankle: 16,
};

interface RawLandmark {
  x: number;
  y: number;
  visibility?: number;
}

/** Convert one MediaPipe PoseLandmarker result (normalized landmarks) into canonical keypoints. */
export function fromBlazePose(landmarks: RawLandmark[]): PoseFrame["kp"] {
  return JOINTS.map((j) => {
    const p = landmarks[BLAZEPOSE[j]];
    return p ? [p.x, p.y, clamp01(p.visibility ?? 1)] : null;
  });
}

/** Convert one YOLO pose detection. `points` are pixels, `conf` the per-keypoint confidence. */
export function fromCoco17(points: [number, number][], conf: number[], width: number, height: number): PoseFrame["kp"] {
  return JOINTS.map((j) => {
    const i = COCO17[j];
    if (i === undefined || !points[i]) return null;
    return [points[i][0] / width, points[i][1] / height, clamp01(conf[i] ?? 0)];
  });
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
