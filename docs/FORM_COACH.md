# Form coach: pipeline, golden set, and evals

The form coach reviews one set of an exercise from the user's video, works out the most likely reason a rep went wrong, and proposes a change. It reuses Pivot's main rule: **the model reasons and proposes, code measures and decides what's allowed.**

## Pipeline

```
video (stays on the device)
   │  pose model: MediaPipe BlazePose or YOLO pose
   ▼
keypoints: 17 joints per frame  ─────────────────────────────  src/lib/form/pose.ts
   │
   ▼
analyzeMovement (code, no model)                              src/lib/form/analyze.ts
   joint angles → reps → per-rep features → rule-checked faults → within-set trends
   │
   ├── compareToGolden: features vs. good-form clips, DTW on the rep's angle curve   golden.ts
   │
   ▼
agent loop (model + tools, max 8 turns)                       src/lib/agent/loop.ts, src/lib/form/coach.ts
   get_movement_guide   how the movement should look, measurable faults and their causes
   get_rep_metrics      numbers per rep and clip quality
   get_measured_faults  the only faults the model may report
   compare_to_golden    how this set differs from the golden examples
   get_history_signals  load change, RPE, the user's note, past sessions, this week's training
   find_fixes           regressions and drills this user can actually do
   submit_coaching      final answer (terminal tool)
   │
   ▼
grounding gate (code)                                         coach.ts → gate()
   drops faults that weren't measured, reps that weren't faulty, causes not in the guide,
   exercises/drills not in the catalog or not available to the user; clamps load changes;
   adds a fixed safety note if the user mentions pain
   │
   ▼
POST /api/form-coach response: feedback + measured faults + golden deviations + what the gate dropped + the tool trace
```

Without an API key, or if the model fails, the same pipeline runs with a rule-based coach (`ruleBasedCoach`) and the response says `generatedBy: "rule_based"`.

### Why we compare angles, not raw positions

Two people's keypoints can't be compared directly: height, limb length, camera distance and speed all differ. So a golden reference stores, per movement:

1. the spread (mean, SD, 10th–90th percentile) of each per-rep feature, such as minimum knee angle or torso lean at the bottom. Angles and ratios don't depend on body size or camera distance.
2. the average shape of the main joint angle over one rep, time-normalized and compared with dynamic time warping, so a slower tempo isn't counted as a difference.

A deviation from golden isn't a fault by itself. Faults come from the rules in `movements.ts`; golden deviations are extra evidence the model can cite.

## Movements covered

`src/lib/form/movements.ts` has the text description the model reads (setup, phases, checkpoints), the fault rules, the possible causes for each fault, cues, and fixes:

| Movement | Catalog exercises | View | Faults |
| --- | --- | --- | --- |
| squat | bw_squat, goblet_squat, back_squat, band_squat | side (knee cave: front) | shallow depth, forward lean, heel lift, knees caving in |
| hinge | db_rdl, deadlift, kb_swing | side | squatting the hinge, not hinging far enough |
| push_up | push_up, incline_push_up | side | hip sag, piking, partial range |
| lunge | reverse_lunge, db_split_squat, step_up | side | shallow, forward lean |

Each guide also lists what the view **can't** show (for example lower-back rounding from 2D points), and the model is told to say so instead of guessing.

**The thresholds are starting points, not validated numbers.** Calibrate them on the labeled clips and write down every change.

## Building the golden set

1. **Record.** For each movement: at least 5 good-form clips from at least 3 people, plus clips with each fault done on purpose (for example 3 per fault). Use the recording setup in each guide's `recording` field: phone at hip height, exactly side-on, whole body in frame. If you want to evaluate diagnosis, record some faulty clips for a known cause, such as the last reps of a hard set (fatigue) or a heavier load than usual.
2. **Label.** Ideally a coach or experienced lifter labels each clip as `good` or `faulty`, with the fault ids they see. If you can, have two people label independently and report how often they agree.
3. **Extract keypoints** (video stays local, only keypoints are saved):
   ```bash
   python3 scripts/form/extract_pose.py squat_good_01.mov --movement squat --exercise goblet_squat --label good --view side --rater jf
   python3 scripts/form/extract_pose.py squat_shallow_03.mov --movement squat --label faulty --faults squat_shallow --cause fatigue
   ```
   Setup notes are at the top of the script. Output goes to `data/form/clips/<movement>/`.
4. **Build references:** `npm run form:references`. This writes `src/lib/form/references/<movement>.json` and the index the app imports.
5. **Evaluate:** `npm run form:eval` (rule-based coach) or `npm run form:eval -- --coach agent` (needs `LLM_API_KEY`). Results go to `evals/results/runs/`.

Don't commit videos. Clips of people's bodies are sensitive. Get consent from anyone you record, use only team members or consenting participants, and check with the teaching team before collecting user videos.

## Metrics the eval script reports

- **A. Fault detection:** precision and recall of the measured faults against human labels, for each fault id.
- **B. Grounded feedback:** precision and recall of the faults the coach actually tells the user (after the gate), plus how many claims the gate dropped.
- **C. Diagnosis:** on clips recorded for a known cause, how often the top finding names that cause.

The golden comparison is leave-one-out: the clip being scored is never part of its own reference.

**Baseline still to build:** send sampled video frames straight to a multimodal model with the same movement description and ask for faults and causes. Comparing that with this pipeline on the same labeled clips is the "our scaffolding beats a generic model" result for the report.

## The Form correction page (`/form`)

A chat-style flow, linked from the header and the home page:

1. The coach greets the user and gives filming tips. The user uploads or drops a clip.
2. While MediaPipe tracks the joints in the browser (`src/lib/form/browserPose.ts`), the coach asks which movement it is. The user can pick one or tap "Detect it for me" (`detect.ts`), and the coach asks them to confirm its guess.
3. The coach asks about the set (weight, effort, anything that hurt). Load and RPE are read from the text (`parseSetNote`), and the whole note goes to the agent.
4. `/api/form-coach` runs the review. While it works, the page shows the steps; afterwards it lists the tools the agent actually called.
5. The result: the user's video with the skeleton drawn on top (`SkeletonPlayer.tsx`), a live joint angle, a rep counter, faulty reps in red, rep chips that jump to each rep, the feedback, and a button that renders a downloadable annotated video.
6. Follow-up questions go to `/api/form-coach/chat`, which runs the same tools in a loop. This needs the AI; without a key, the page says so.

Each reviewed set is saved in the browser (`formHistory.ts`: date, movement, load, RPE, faults, never video or keypoints), so the next review can see load changes and recurring faults.

**Browser test hook:** in development only, setting `window.__pivotTestPose` to a `PoseSequence` skips MediaPipe. Browser tests use it because test videos have no real person in them.

## Not built yet

- Writing `changes` back into the weekly plan through `applyOperations` and the existing validation gate.
- A live run of the agent against the model. The loop, tools, gate and chat are tested with a scripted model only.
- A tested run on a real person's video. The page has only been tested with injected keypoints, and MediaPipe was only run on a clip with no person in it.
- YOLO in the browser. The page uses MediaPipe; YOLO is available in the offline extraction script.
