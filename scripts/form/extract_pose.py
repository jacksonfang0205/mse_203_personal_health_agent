#!/usr/bin/env python3
"""
Extract body keypoints from a workout video into Pivot's clip format.

The output JSON is a LabeledClip (see src/lib/form/golden.ts): clip metadata
plus a PoseSequence with 17 canonical joints per frame. The same format is
used for golden clips, labeled eval clips and (later) user uploads, so the
analysis code never cares which model produced the points.

Setup (once):
    python3 -m venv .venv-pose && source .venv-pose/bin/activate
    pip install mediapipe opencv-python          # MediaPipe backend (default)
    pip install ultralytics opencv-python        # optional YOLO backend
    # MediaPipe model file (~10 MB):
    curl -L -o pose_landmarker_full.task \
      https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task

Examples:
    # A good-form golden clip
    python3 scripts/form/extract_pose.py squat_good_01.mov --movement squat \
        --exercise goblet_squat --label good --view side --rater jf

    # A clip recorded with a deliberate fault, for evals
    python3 scripts/form/extract_pose.py squat_shallow_03.mov --movement squat \
        --label faulty --faults squat_shallow --cause fatigue --view side

Output goes to data/form/clips/<movement>/<clip id>.json unless --out is given.
Videos never leave your machine and are not committed; only keypoints are.
"""
import argparse
import json
import os
import sys

JOINTS = [
    "nose", "l_shoulder", "r_shoulder", "l_elbow", "r_elbow", "l_wrist", "r_wrist",
    "l_hip", "r_hip", "l_knee", "r_knee", "l_ankle", "r_ankle", "l_heel", "r_heel", "l_toe", "r_toe",
]
BLAZEPOSE = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
COCO17 = [0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, None, None, None, None]


def r4(v):
    return round(float(v), 4)


def extract_mediapipe(path, model_path, every):
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    if not os.path.exists(model_path):
        sys.exit(f"MediaPipe model not found at {model_path}. See the setup notes at the top of this file.")
    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model_path),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
    )
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frames = []
    i = 0
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        while True:
            ok, img = cap.read()
            if not ok:
                break
            if i % every == 0:
                t_ms = int(round(i * 1000 / fps))
                rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                result = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), t_ms)
                if result.pose_landmarks:
                    lm = result.pose_landmarks[0]
                    kp = [[r4(lm[j].x), r4(lm[j].y), r4(max(0.0, min(1.0, lm[j].visibility or 0.0)))] for j in BLAZEPOSE]
                else:
                    kp = [None] * len(JOINTS)
                frames.append({"t": t_ms, "kp": kp})
            i += 1
    cap.release()
    return "mediapipe_blazepose", fps / every, width, height, frames


def extract_yolo(path, weights, every):
    import cv2
    from ultralytics import YOLO

    model = YOLO(weights)
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frames = []
    i = 0
    while True:
        ok, img = cap.read()
        if not ok:
            break
        if i % every == 0:
            t_ms = int(round(i * 1000 / fps))
            res = model(img, verbose=False)[0]
            kp = [None] * len(JOINTS)
            if res.keypoints is not None and len(res.keypoints) > 0:
                # Largest person in frame = the lifter.
                boxes = res.boxes.xywh.cpu().numpy()
                best = int((boxes[:, 2] * boxes[:, 3]).argmax())
                xy = res.keypoints.xy[best].cpu().numpy()
                conf = res.keypoints.conf[best].cpu().numpy() if res.keypoints.conf is not None else [1.0] * len(xy)
                kp = [None if c is None else [r4(xy[c][0] / width), r4(xy[c][1] / height), r4(conf[c])] for c in COCO17]
            frames.append({"t": t_ms, "kp": kp})
        i += 1
    cap.release()
    return "yolo_pose", fps / every, width, height, frames


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("video")
    p.add_argument("--movement", required=True, choices=["squat", "hinge", "push_up", "lunge"])
    p.add_argument("--exercise", help="catalog id, e.g. goblet_squat")
    p.add_argument("--label", required=True, choices=["good", "faulty"])
    p.add_argument("--faults", default="", help="comma-separated fault ids from movements.ts")
    p.add_argument("--cause", help="cause the clip was recorded to show, e.g. fatigue")
    p.add_argument("--view", default="side", choices=["side", "front", "unknown"])
    p.add_argument("--rater", help="who labeled the clip")
    p.add_argument("--notes")
    p.add_argument("--id", help="clip id (default: video file name)")
    p.add_argument("--backend", default="mediapipe", choices=["mediapipe", "yolo"])
    p.add_argument("--model", default="pose_landmarker_full.task", help="MediaPipe .task file or YOLO weights")
    p.add_argument("--every", type=int, default=1, help="keep every Nth frame (2 halves the frame rate)")
    p.add_argument("--out")
    a = p.parse_args()

    if a.backend == "mediapipe":
        source, fps, w, h, frames = extract_mediapipe(a.video, a.model, a.every)
    else:
        source, fps, w, h, frames = extract_yolo(a.video, a.model if a.model.endswith(".pt") else "yolo11n-pose.pt", a.every)
    if not frames:
        sys.exit("No frames read from the video.")
    seen = sum(1 for f in frames if f["kp"][JOINTS.index("l_hip")] or f["kp"][JOINTS.index("r_hip")])
    clip_id = a.id or os.path.splitext(os.path.basename(a.video))[0]
    clip = {
        "id": clip_id,
        "movementId": a.movement,
        **({"exerciseId": a.exercise} if a.exercise else {}),
        "label": a.label,
        "faults": [f for f in a.faults.split(",") if f],
        **({"cause": a.cause} if a.cause else {}),
        **({"rater": a.rater} if a.rater else {}),
        **({"notes": a.notes} if a.notes else {}),
        "pose": {"version": 1, "source": source, "fps": round(fps, 3), "width": w, "height": h, "view": a.view, "frames": frames[:4000]},
    }
    out = a.out or os.path.join("data", "form", "clips", a.movement, f"{clip_id}.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as fh:
        json.dump(clip, fh, separators=(",", ":"))
    print(f"Wrote {out}: {len(frames)} frames at {fps:.1f} fps, person found in {seen}/{len(frames)} frames.")
    if len(frames) > 4000:
        print("Warning: clip truncated to 4000 frames. Use --every 2 for long clips.")


if __name__ == "__main__":
    main()
