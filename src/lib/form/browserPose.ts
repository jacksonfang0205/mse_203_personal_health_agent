/**
 * In-browser pose tracking with MediaPipe PoseLandmarker. The video never
 * leaves the device: we step through it frame by frame, keep only the 17
 * canonical keypoints, and send those to the server.
 *
 * Browser only. Import it from client components, and only call it from event
 * handlers or effects.
 */
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { detectView } from "./analyze";
import { fromBlazePose, JOINTS, type CameraView, type PoseFrame, type PoseSequence } from "./pose";

/** Keep in sync with the @mediapipe/tasks-vision version in package.json. */
const MEDIAPIPE_VERSION = "1.1.1";
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
/** Same model family as scripts/form/extract_pose.py, so user clips match the golden set. */
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

export const MAX_CLIP_SECONDS = 90;

let landmarker: Promise<PoseLandmarker> | null = null;

function getLandmarker(): Promise<PoseLandmarker> {
  landmarker ??= (async () => {
    const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO" as const,
      numPoses: 1,
    });
    try {
      return await PoseLandmarker.createFromOptions(fileset, options("GPU"));
    } catch {
      return await PoseLandmarker.createFromOptions(fileset, options("CPU"));
    }
  })();
  landmarker.catch(() => {
    landmarker = null;
  });
  return landmarker;
}

/** Start downloading the model early, e.g. when the page opens. */
export function preloadPoseModel() {
  getLandmarker().catch(() => undefined);
}

function once(el: HTMLMediaElement, event: string, ms = 8000) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for the video (${event}).`));
    }, ms);
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("This browser can't read that video. Try an .mp4, or record it again with your phone's camera app."));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      el.removeEventListener(event, ok);
      el.removeEventListener("error", fail);
    };
    el.addEventListener(event, ok);
    el.addEventListener("error", fail);
  });
}

export interface ExtractOptions {
  fps?: number;
  view?: CameraView;
  onProgress?: (fraction: number, stage: "model" | "tracking") => void;
  signal?: AbortSignal;
}

export interface ExtractResult {
  pose: PoseSequence;
  durationS: number;
  /** Fraction of sampled frames where a person was found. */
  detectedFraction: number;
}

export async function extractPose(videoUrl: string, o: ExtractOptions = {}): Promise<ExtractResult> {
  // Development-only test hook: browser tests inject keypoints because test videos have no real person in them.
  const testPose = process.env.NODE_ENV !== "production" ? (window as { __pivotTestPose?: PoseSequence }).__pivotTestPose : undefined;
  if (testPose) {
    o.onProgress?.(1, "tracking");
    const last = testPose.frames[testPose.frames.length - 1];
    return { pose: { ...testPose, view: o.view ?? detectView(testPose) }, durationS: last.t / 1000, detectedFraction: 1 };
  }
  const fps = o.fps ?? 15;
  o.onProgress?.(0, "model");
  const model = await getLandmarker();

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = videoUrl;
  await once(video, "loadeddata", 15000);

  const durationS = video.duration;
  if (!Number.isFinite(durationS) || durationS <= 0) throw new Error("Couldn't read the video's length.");
  if (durationS > MAX_CLIP_SECONDS) throw new Error(`That clip is ${Math.round(durationS)} s long. Trim it to one set, under ${MAX_CLIP_SECONDS} s.`);

  const total = Math.max(1, Math.floor(durationS * fps));
  const frames: PoseFrame[] = [];
  let found = 0;
  let lastTs = -1;
  for (let i = 0; i < total; i++) {
    if (o.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const t = Math.min(i / fps, durationS - 0.01);
    video.currentTime = t;
    await once(video, "seeked");
    const ts = Math.max(lastTs + 1, Math.round(t * 1000));
    lastTs = ts;
    const result = model.detectForVideo(video, ts);
    const lm = result.landmarks?.[0];
    if (lm) found++;
    frames.push({ t: Math.round(t * 1000), kp: lm ? fromBlazePose(lm) : JOINTS.map(() => null) });
    o.onProgress?.((i + 1) / total, "tracking");
  }

  // Read the size before unloading the video: afterwards videoWidth/videoHeight are 0. Keypoints are 0..1 on each axis,
  // so without the real size a portrait phone clip gets squashed square and every angle is wrong.
  const width = video.videoWidth, height = video.videoHeight;
  video.removeAttribute("src");
  video.load();
  if (!width || !height) throw new Error("Couldn't read the video's size.");
  const pose: PoseSequence = {
    version: 1,
    source: "mediapipe_blazepose",
    fps,
    width,
    height,
    view: "side",
    frames,
  };
  // Side or front changes which checks can run, so work it out from the clip unless the caller says.
  pose.view = o.view ?? detectView(pose);
  return {
    pose,
    durationS,
    detectedFraction: found / total,
  };
}
