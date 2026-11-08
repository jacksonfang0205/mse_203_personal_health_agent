import { describe, expect, it } from "vitest";
import { runToolLoop, type ClientRequest, type ClientTurn, type LoopClient } from "../agent/loop";
import type { FitnessProfile } from "../schemas";
import { analyzeMovement } from "./analyze";
import { coachForm, SAFETY_NOTE, type FormCoachRequest } from "./coach";
import { buildReference, compareToGolden, dtw, type LabeledClip } from "./golden";
import { MOVEMENTS } from "./movements";
import { fromBlazePose, fromCoco17, JOINTS } from "./pose";
import { syntheticPushUp, syntheticSquat } from "./synthetic";
import { z } from "zod";

const profile: FitnessProfile = {
  version: 1,
  goals: ["strength"],
  targetMuscles: [],
  experience: "beginner",
  workoutTypes: ["home"],
  equipment: ["dumbbells"],
  sessionMinutes: 40,
  frequencyPerWeek: 3,
  preferredDays: ["mon", "wed", "fri"],
  preferredTimes: ["evening"],
  avoidTags: [],
  avoidExerciseIds: [],
  avoidNotes: "",
  limitations: "",
  updatedAt: "2026-11-01T00:00:00Z",
};

const request = (over: Partial<FormCoachRequest> = {}): FormCoachRequest => ({
  movementId: "squat",
  exerciseId: "goblet_squat",
  pose: syntheticSquat(),
  set: {},
  profile,
  formHistory: [],
  log: [],
  now: { date: "2026-11-08" },
  ...over,
});

describe("pose conversion", () => {
  it("maps BlazePose and COCO keypoints to canonical joints", () => {
    const blaze = Array.from({ length: 33 }, (_, i) => ({ x: i / 100, y: i / 100, visibility: 0.9 }));
    const kp = fromBlazePose(blaze);
    expect(kp).toHaveLength(JOINTS.length);
    expect(kp[JOINTS.indexOf("l_knee")]).toEqual([0.25, 0.25, 0.9]);
    const coco = fromCoco17(Array.from({ length: 17 }, (_, i) => [i * 10, i * 20] as [number, number]), Array(17).fill(0.8), 1000, 1000);
    expect(coco[JOINTS.indexOf("l_knee")]).toEqual([0.13, 0.26, 0.8]);
    expect(coco[JOINTS.indexOf("l_heel")]).toBeNull();
  });
});

describe("analysis", () => {
  it("counts reps and finds no faults on a good squat", () => {
    const a = analyzeMovement(syntheticSquat({ reps: 5 }), MOVEMENTS.squat);
    expect(a.quality.ok).toBe(true);
    expect(a.reps).toHaveLength(5);
    expect(a.faults).toEqual([]);
    expect(a.summary.min_knee_angle).toBeGreaterThan(80);
    expect(a.summary.min_knee_angle).toBeLessThan(92);
  });

  it("flags shallow depth on every rep", () => {
    const a = analyzeMovement(syntheticSquat({ bottomKneeDeg: 120 }), MOVEMENTS.squat);
    expect(a.faults.map((f) => f.faultId)).toEqual(["squat_shallow"]);
    expect(a.faults[0].pattern).toBe("consistent");
  });

  it("flags forward lean and heel lift", () => {
    const ids = analyzeMovement(syntheticSquat({ leanDeg: 65, heelLift: 0.08 }), MOVEMENTS.squat).faults.map((f) => f.faultId);
    expect(ids).toContain("squat_forward_lean");
    expect(ids).toContain("squat_heel_lift");
  });

  it("labels faults that appear only at the end of a set as late_reps", () => {
    const a = analyzeMovement(syntheticPushUp({ fatigueSagDeg: 25 }), MOVEMENTS.push_up);
    const sag = a.faults.find((f) => f.faultId === "push_up_hip_sag");
    expect(sag?.pattern).toBe("late_reps");
    expect(Math.min(...sag!.reps)).toBeGreaterThan(3);
  });

  it("finds push-up sag and partial range", () => {
    expect(analyzeMovement(syntheticPushUp({ sagDeg: 20 }), MOVEMENTS.push_up).faults.map((f) => f.faultId)).toEqual(["push_up_hip_sag"]);
    expect(analyzeMovement(syntheticPushUp({ bottomElbowDeg: 120 }), MOVEMENTS.push_up).faults.map((f) => f.faultId)).toEqual(["push_up_partial"]);
  });

  it("refuses to measure a clip where the joints aren't visible", () => {
    const pose = syntheticSquat();
    pose.frames = pose.frames.map((f) => ({ ...f, kp: f.kp.map((k) => (k ? [k[0], k[1], 0.2] : null)) as typeof f.kp }));
    const a = analyzeMovement(pose, MOVEMENTS.squat);
    expect(a.quality.ok).toBe(false);
    expect(a.faults).toEqual([]);
  });
});

describe("golden comparison", () => {
  const clip = (id: string, pose = syntheticSquat({ seed: id.length }), label: "good" | "faulty" = "good"): LabeledClip => ({ id, movementId: "squat", label, faults: [], pose });
  const ref = buildReference(MOVEMENTS.squat, [
    clip("g1", syntheticSquat({ bottomKneeDeg: 82, leanDeg: 38, seed: 1 })),
    clip("g2", syntheticSquat({ bottomKneeDeg: 88, leanDeg: 42, seed: 2 })),
    clip("g3", syntheticSquat({ bottomKneeDeg: 85, leanDeg: 45, seed: 3 })),
  ], "2026-11-08T00:00:00Z");

  it("builds feature stats and a template", () => {
    expect(ref.clipIds).toEqual(["g1", "g2", "g3"]);
    expect(ref.template).toHaveLength(40);
    expect(ref.features.min_knee_angle.mean).toBeGreaterThan(80);
  });

  it("matches a good squat and flags a shallow one", () => {
    const good = compareToGolden(analyzeMovement(syntheticSquat({ seed: 9 }), MOVEMENTS.squat), ref);
    expect(good.deviations.map((d) => d.feature)).not.toContain("min_knee_angle");
    expect(Math.min(...good.shapeSimilarity)).toBeGreaterThan(70);
    const shallow = compareToGolden(analyzeMovement(syntheticSquat({ bottomKneeDeg: 125, seed: 9 }), MOVEMENTS.squat), ref);
    expect(shallow.deviations.find((d) => d.feature === "min_knee_angle")?.direction).toBe("higher");
  });

  it("says when no reference exists", () => {
    expect(compareToGolden(analyzeMovement(syntheticSquat(), MOVEMENTS.squat), undefined).available).toBe(false);
  });

  it("dtw is zero for identical curves and ignores tempo shifts more than pointwise distance", () => {
    const a = Array.from({ length: 40 }, (_, i) => 180 - 90 * Math.sin((Math.PI * i) / 39));
    const shifted = Array.from({ length: 40 }, (_, i) => 180 - 90 * Math.sin((Math.PI * Math.min(39, i * 1.15)) / 39) ** 1);
    expect(dtw(a, a)).toBe(0);
    const pointwise = a.reduce((s, v, i) => s + Math.abs(v - shifted[i]), 0) / a.length;
    expect(dtw(a, shifted)).toBeLessThan(pointwise);
  });
});

/** Scripted model: returns the given turns in order. Records each request. */
function scripted(turns: Omit<ClientTurn, "usage">[]): { client: LoopClient; requests: ClientRequest[] } {
  const requests: ClientRequest[] = [];
  let i = 0;
  return {
    requests,
    client: async (req) => {
      requests.push(structuredClone(req));
      const t = turns[Math.min(i++, turns.length - 1)];
      return { ...t, usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
}

describe("agent loop", () => {
  const final = { name: "done", description: "finish", schema: z.object({ answer: z.number() }) };
  const add = { name: "add", description: "add", schema: z.object({ a: z.number(), b: z.number() }), run: ({ a, b }: { a: number; b: number }) => ({ sum: a + b }) };

  it("runs tools, returns their results to the model, then finishes", async () => {
    const { client, requests } = scripted([
      { text: "", calls: [{ id: "1", name: "add", input: { a: 2, b: 3 } }] },
      { text: "", calls: [{ id: "2", name: "done", input: { answer: 5 } }] },
    ]);
    const r = await runToolLoop({ system: "s", user: "u", tools: [add as never], final, client });
    expect(r.output).toEqual({ answer: 5 });
    expect(r.trace.map((t) => t.tool)).toEqual(["add", "done"]);
    const results = requests[1].messages.at(-1);
    expect(results).toMatchObject({ role: "tool_results", results: [{ id: "1", content: '{"sum":5}' }] });
  });

  it("sends input errors back instead of throwing, and forces the final tool on the last step", async () => {
    const { client, requests } = scripted([
      { text: "", calls: [{ id: "1", name: "add", input: { a: "x" } }] },
      { text: "", calls: [{ id: "2", name: "done", input: { answer: "nope" } }] },
      { text: "", calls: [{ id: "3", name: "done", input: { answer: 1 } }] },
    ]);
    const r = await runToolLoop({ system: "s", user: "u", tools: [add as never], final, client, maxSteps: 3 });
    expect(r.output).toEqual({ answer: 1 });
    expect(r.trace.filter((t) => !t.ok)).toHaveLength(2);
    expect(requests[2].toolChoice).toEqual({ name: "done" });
    expect(requests[2].tools.map((t) => t.name)).toEqual(["done"]);
  });

  it("gives up after maxSteps without a final answer", async () => {
    const { client } = scripted([{ text: "thinking", calls: [] }]);
    await expect(runToolLoop({ system: "s", user: "u", tools: [], final, client, maxSteps: 2 })).rejects.toThrow(/did not finish/);
  });
});

describe("form coach", () => {
  it("works without a model and stays grounded in measured faults", async () => {
    const r = await coachForm(request({ pose: syntheticSquat({ bottomKneeDeg: 120 }) }), { ruleBased: true, references: {} });
    expect(r.generatedBy).toBe("rule_based");
    expect(r.feedback.findings.map((f) => f.faultId)).toEqual(["squat_shallow"]);
    expect(r.feedback.findings[0].cause?.id).toBe("technique_unfamiliar");
    expect(r.feedback.changes.length).toBeGreaterThan(0);
  });

  it("blames load when the fault follows a load jump", async () => {
    const r = await coachForm(
      request({
        pose: syntheticSquat({ leanDeg: 65 }),
        profile: { ...profile, experience: "intermediate" },
        set: { loadKg: 24 },
        formHistory: [{ date: "2026-11-05", movementId: "squat", loadKg: 16, faults: [] }],
      }),
      { ruleBased: true, references: {} },
    );
    expect(r.feedback.findings[0]).toMatchObject({ faultId: "squat_forward_lean", cause: { id: "load_too_heavy" } });
    expect(r.feedback.changes[0]).toMatchObject({ kind: "reduce_load", loadChangePct: -10 });
  });

  it("adds a safety note when the user mentions pain", async () => {
    const r = await coachForm(request({ set: { note: "my knee hurts at the bottom" } }), { ruleBased: true, references: {} });
    expect(r.safety).toBe(SAFETY_NOTE);
  });

  it("runs the agent loop and the gate drops invented faults, causes and exercises", async () => {
    const { client, requests } = scripted([
      { text: "", calls: [{ id: "1", name: "get_movement_guide", input: {} }, { id: "2", name: "get_measured_faults", input: {} }] },
      { text: "", calls: [{ id: "3", name: "find_fixes", input: { fault_id: "squat_shallow" } }] },
      {
        text: "",
        calls: [
          {
            id: "4",
            name: "submit_coaching",
            input: {
              headline: "Get deeper.",
              findings: [
                { fault_id: "squat_shallow", reps: [1, 2, 99], likely_cause: "ankle_mobility", cause_evidence: "Shallow from rep 1.", confidence: "medium" },
                { fault_id: "squat_knee_valgus", reps: [2], likely_cause: "fatigue", cause_evidence: "made up", confidence: "high" },
              ],
              cues: ["Sit between your heels."],
              changes: [
                { kind: "add_drill", drill_id: "ankle_rocks", reason: "Mobility." },
                { kind: "swap_exercise", exercise_id: "back_squat", reason: "Needs a barbell the user doesn't have." },
                { kind: "add_drill", drill_id: "made_up_drill", reason: "Invented." },
              ],
              retest: "Film from the side next session.",
              cannot_assess: ["Lower-back rounding"],
            },
          },
        ],
      },
    ]);
    const r = await coachForm(request({ pose: syntheticSquat({ bottomKneeDeg: 120 }) }), { client, references: {} });
    expect(r.generatedBy).toBe("agent");
    expect(r.feedback.findings).toHaveLength(1);
    expect(r.feedback.findings[0]).toMatchObject({ faultId: "squat_shallow", reps: [1, 2], cause: { id: "ankle_mobility" } });
    expect(r.feedback.changes.map((c) => c.drillId ?? c.exerciseId)).toEqual(["ankle_rocks"]);
    expect(r.dropped.length).toBeGreaterThanOrEqual(3);
    expect(r.trace?.map((t) => t.tool)).toEqual(["get_movement_guide", "get_measured_faults", "find_fixes", "submit_coaching"]);
    // find_fixes only offers things a dumbbell-only user can do.
    const fixes = requests[2].messages.at(-1);
    expect(JSON.stringify(fixes)).not.toContain("back_squat");
  });

  it("falls back to rule-based feedback if the model fails", async () => {
    const client: LoopClient = async () => {
      throw new Error("gateway down");
    };
    const r = await coachForm(request(), { client, references: {} });
    expect(r.generatedBy).toBe("rule_based");
    expect(r.error).toMatch(/gateway down/);
  });
});

describe("movement detection", () => {
  it("recognizes squats and push-ups", async () => {
    const { detectMovement } = await import("./detect");
    expect(detectMovement(syntheticSquat()).movementId).toBe("squat");
    expect(detectMovement(syntheticPushUp()).movementId).toBe("push_up");
  });

  it("gives up when no one is visible", async () => {
    const { detectMovement } = await import("./detect");
    const pose = syntheticSquat();
    pose.frames = pose.frames.map((f) => ({ ...f, kp: f.kp.map(() => null) }));
    expect(detectMovement(pose).movementId).toBeNull();
  });
});

describe("set notes", () => {
  it("parses load and effort", async () => {
    const { parseSetNote } = await import("./formHistory");
    expect(parseSetNote("20 kg goblet squat, RPE 8")).toEqual({ loadKg: 20, rpe: 8 });
    expect(parseSetNote("45 lbs, felt like 7/10")).toEqual({ loadKg: 20.4, rpe: 7 });
    expect(parseSetNote("felt fine")).toEqual({});
  });
});

describe("form chat", () => {
  it("answers through the tool loop and flags pain", async () => {
    const { chatAboutForm } = await import("./coach");
    const { client } = scripted([
      { text: "", calls: [{ id: "1", name: "get_rep_metrics", input: { reps: [6] } }] },
      { text: "", calls: [{ id: "2", name: "reply", input: { message: "Rep 6 got shallower as you tired.", followups: ["How many reps next time?"] } }] },
    ]);
    const r = await chatAboutForm(
      { ...request({ pose: syntheticSquat({ fatigueDeg: 35 }) }), previousFeedback: "Depth dropped on rep 6.", messages: [{ role: "user", content: "Why? Also my knee hurts a bit" }] },
      { client, references: {} },
    );
    expect(r.message).toMatch(/Rep 6/);
    expect(r.trace.map((t) => t.tool)).toEqual(["get_rep_metrics", "reply"]);
    expect(r.safety).toBe(SAFETY_NOTE);
  });

  it("returns rep timing for the video overlay", async () => {
    const r = await coachForm(request({ pose: syntheticSquat({ bottomKneeDeg: 120 }) }), { ruleBased: true, references: {} });
    expect(r.reps).toHaveLength(r.repCount);
    expect(r.reps[0].startMs).toBeLessThan(r.reps[0].bottomMs);
    expect(r.reps[0].faults).toContain("squat_shallow");
  });
});

describe("every measured fault is shown", () => {
  const messy = () => syntheticSquat({ bottomKneeDeg: 118, leanDeg: 62, heelLift: 0.08 });

  it("rule-based coach lists them all, with the measured value", async () => {
    const r = await coachForm(request({ pose: messy() }), { ruleBased: true, references: {} });
    expect(r.feedback.findings.map((f) => f.faultId).sort()).toEqual(["squat_forward_lean", "squat_heel_lift", "squat_shallow"]);
    expect(r.feedback.findings.find((f) => f.faultId === "squat_forward_lean")?.measured?.text).toMatch(/Torso lean from vertical: \d+° at worst \(limit: at most 55°\)/);
    const keys = r.feedback.changes.map((c) => `${c.kind}:${c.drillId ?? c.exerciseId ?? ""}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("adds back faults the model left out", async () => {
    const { client } = scripted([
      {
        text: "",
        calls: [
          {
            id: "1",
            name: "submit_coaching",
            input: {
              headline: "Heels.",
              findings: [{ fault_id: "squat_heel_lift", reps: [1], likely_cause: "ankle_mobility", cause_evidence: "x", confidence: "medium" }],
              cues: [],
              changes: [],
              cannot_assess: [],
            },
          },
        ],
      },
    ]);
    const r = await coachForm(request({ pose: messy() }), { client, references: {} });
    expect(r.feedback.findings.map((f) => f.faultId)).toEqual(["squat_heel_lift", "squat_shallow", "squat_forward_lean"]);
  });
});

describe("front-view clips", () => {
  it("detects the camera angle", async () => {
    const { detectView } = await import("./analyze");
    const { syntheticFrontSquat } = await import("./synthetic");
    expect(detectView(syntheticFrontSquat())).toBe("front");
    expect(detectView(syntheticSquat())).toBe("side");
  });

  it("counts reps by hip height and flags knees caving in, only from the front", async () => {
    const { syntheticFrontSquat } = await import("./synthetic");
    const good = analyzeMovement(syntheticFrontSquat({ bottomKneeRatio: 1.1 }), MOVEMENTS.squat);
    expect(good.reps).toHaveLength(6);
    expect(good.faults).toEqual([]);
    const caving = analyzeMovement(syntheticFrontSquat({ bottomKneeRatio: 0.7 }), MOVEMENTS.squat);
    expect(caving.faults.map((f) => f.faultId)).toEqual(["squat_knee_valgus"]);
    expect(caving.faults[0].reps).toHaveLength(6);
  });

  it("guesses a squat from the front", async () => {
    const { detectMovement } = await import("./detect");
    const { syntheticFrontSquat } = await import("./synthetic");
    expect(detectMovement(syntheticFrontSquat()).movementId).toBe("squat");
  });
});
