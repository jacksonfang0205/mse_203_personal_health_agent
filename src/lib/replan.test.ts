/**
 * Re-plan rules from user review: locked preferences, an honest "Fits your
 * schedule" badge, option text that matches what is applied, remembered
 * injuries, asking before big changes, and two guardrails (no back-to-back
 * leg days, no marking a workout done before its day).
 */
import { describe, expect, it } from "vitest";
import type { AgentRequest } from "./agent/context";
import { gate } from "./agent/lifeHappens";
import { needsClarification } from "./coach/clarify";
import { describeSwaps, detectInjury, removeConflictingExercises, withInjury } from "./injuries";
import { proposeRuleBasedAlternatives } from "./planner/alternatives";
import { resolveClashes } from "./planner/clashes";
import { bendQuestion, describeOperation, finalizeAlternative, textMatchesOperations } from "./planner/describe";
import { generateMockWeek } from "./planner/generate";
import type { BusyBlock, FitnessProfile, WeeklyPlan, Workout } from "./schemas";
import { formatDate, humanizeDates, weekDates } from "./time";
import { assessChange, checkPreferences, isLowerBody, validatePlan, type ValidationContext } from "./validation";
import { doneBlockedReason } from "./workoutStatus";

const WEEK = "2026-11-16"; // Monday
const NOW = { date: WEEK, time: "07:00" };
const RANGE = { start: WEEK, end: "2026-11-22" };

const profile: FitnessProfile = {
  version: 1,
  goals: ["strength"],
  targetMuscles: [],
  experience: "intermediate",
  workoutTypes: ["home", "running"],
  equipment: ["dumbbells"],
  sessionMinutes: 45,
  frequencyPerWeek: 3,
  preferredDays: ["mon", "wed", "fri"],
  preferredTimes: ["evening"],
  avoidTags: [],
  avoidExerciseIds: [],
  avoidNotes: "",
  limitations: "",
  updatedAt: "2026-11-01T00:00:00Z",
};

const upper = (over: Partial<Workout> = {}): Workout => ({
  id: "w-wed",
  title: "Upper body strength",
  date: "2026-11-18",
  start: "18:00",
  durationMin: 45,
  category: "strength",
  muscles: ["back", "arms", "chest"],
  equipment: ["dumbbells"],
  exercises: [
    { exerciseId: "db_row", sets: 3, reps: "10 / side" },
    { exerciseId: "db_floor_press", sets: 3, reps: "10–12" },
    { exerciseId: "db_curl", sets: 3, reps: "10–12" },
  ],
  rationale: "test",
  status: "planned",
  origin: "agent",
  ...over,
});

const legs = (over: Partial<Workout> = {}): Workout => ({
  ...upper(),
  id: "w-mon",
  title: "Lower body strength",
  date: "2026-11-16",
  muscles: ["legs", "glutes", "core"],
  exercises: [
    { exerciseId: "goblet_squat", sets: 3, reps: "8–12" },
    { exerciseId: "db_rdl", sets: 3, reps: "8–10" },
  ],
  ...over,
});

const run = (over: Partial<Workout> = {}): Workout => ({
  ...upper(),
  id: "w-fri",
  title: "Easy run",
  date: "2026-11-20",
  category: "cardio",
  muscles: ["legs", "full_body"],
  equipment: [],
  exercises: [{ exerciseId: "easy_run", minutes: 45 }],
  ...over,
});

const plan = (workouts: Workout[]): WeeklyPlan => ({
  id: "p",
  weekStart: WEEK,
  workouts,
  generatedBy: "agent",
  createdAt: "2026-11-16T00:00:00Z",
  notes: [],
});

const base = plan([legs(), upper(), run()]);
const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  profile,
  busy: [],
  knownRange: RANGE,
  now: NOW,
  previousPlan: base,
  ...over,
});

// The reviewer's case: Wednesday's session moved to Sunday midday and cut to 25 min.
const sundayMidday = plan([legs(), upper({ date: "2026-11-22", start: "12:00", durationMin: 25, exercises: [{ exerciseId: "db_row", sets: 3, reps: "10 / side" }, { exerciseId: "db_curl", sets: 3, reps: "10–12" }] }), run()]);

describe("1. preferences are locked on re-plans", () => {
  it("rejects a re-plan that adds a Sunday, moves to midday, or cuts the session", () => {
    const r = validatePlan(sundayMidday, ctx({ lockPreferences: true }));
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.constraint).sort()).toEqual(["session_length", "time_windows", "training_days"]);
  });

  it("only checks workouts the re-plan changed", () => {
    // Friday's run is already in the plan; moving nothing else must not trip on it.
    const onSat = plan([legs(), upper(), run({ date: "2026-11-21" })]);
    expect(checkPreferences(onSat, ctx({ previousPlan: onSat }))).toEqual([]);
    expect(checkPreferences(onSat, ctx()).map((v) => v.constraint)).toEqual(["training_days"]);
  });

  it("lets a bend through only when the user accepted that exact rule", () => {
    const some = validatePlan(sundayMidday, ctx({ lockPreferences: true, acceptedBends: ["training_days", "time_windows"] }));
    expect(some.violations.map((v) => v.constraint)).toEqual(["session_length"]);
    const all = validatePlan(sundayMidday, ctx({ lockPreferences: true, acceptedBends: ["training_days", "time_windows", "session_length"] }));
    expect(all.ok).toBe(true);
  });

  it("treats a shorter session as fine on a day the user said has less time", () => {
    const short = plan([legs(), upper({ durationMin: 20, exercises: [{ exerciseId: "db_row", sets: 3, reps: "10 / side" }] }), run()]);
    expect(checkPreferences(short, ctx()).map((v) => v.constraint)).toEqual(["session_length"]);
    expect(checkPreferences(short, ctx({ dateLimits: { "2026-11-18": 20 } }))).toEqual([]);
  });

  it("rule-based one-tap options keep full length and never claim to fit when they don't", () => {
    const p = proposeRuleBasedAlternatives({ plan: base, profile, busy: [], knownRange: RANGE, now: NOW, userMessage: "x", proposalId: "pr", createdAt: "x" });
    expect(p.alternatives.length).toBeGreaterThan(0);
    for (const alt of p.alternatives) {
      const verdict = assessChange(
        (() => {
          let next = base;
          for (const op of alt.operations) next = { ...next, workouts: next.workouts.map((w) => (op.op === "move" && w.id === op.workoutId ? { ...w, date: op.date, start: op.start } : op.op === "replace" && w.id === op.workoutId ? op.workout : op.op === "skip" && w.id === op.workoutId ? { ...w, status: "skipped" as const } : w)) };
          return next;
        })(),
        ctx(),
      );
      expect(alt.fit).toBe(verdict.status);
      if (alt.fit === "bends") expect(alt.ask).toMatch(/OK\?$/);
    }
    const swap = p.alternatives.find((a) => a.kind === "swap_format");
    if (swap?.operations[0].op === "replace") expect(swap.operations[0].workout.durationMin).toBe(45);
  });

  it("the clash fix moves within preferences, and only offers a bend with a question", () => {
    // Monday evening is now busy; Wed/Fri evenings are taken, so only off-preference time is left.
    const busy: BusyBlock[] = [{ id: "b", date: "2026-11-16", start: "17:00", end: "21:00", title: "Lab", source: "google" }];
    const r = resolveClashes({ plan: base, profile, busy, now: NOW });
    expect(r.moved).toEqual([]);
    expect(r.needsOk).toHaveLength(1);
    expect(r.needsOk[0].ask).toMatch(/^Only .* is free\. OK\?$/);
    expect(r.plan.workouts.find((w) => w.id === "w-mon")?.date).toBe("2026-11-16"); // not applied

    const free = resolveClashes({ plan: plan([legs(), run()]), profile, busy, now: NOW });
    expect(free.moved[0]?.to).toEqual({ date: "2026-11-18", start: "17:00" });
    expect(free.needsOk).toEqual([]);
  });

  it("strict regeneration only uses training days and windows, and says what it couldn't fit", () => {
    const two = { ...profile, preferredDays: ["mon", "wed"] as FitnessProfile["preferredDays"] };
    const week = generateMockWeek({ profile: two, weekStart: WEEK, busy: [], now: NOW, createdAt: "x", strictPreferences: true });
    expect(week.workouts.map((w) => w.date)).toEqual(["2026-11-16", "2026-11-18"]);
    expect(week.workouts.every((w) => w.start >= "17:00" && w.durationMin === 45)).toBe(true);
    expect(week.notes.join(" ")).toMatch(/2 of your 3 workouts on your training days and times/);
  });
});

describe("2. honest 'Fits your schedule' badge", () => {
  it("is computed by the validator, including days, windows and length", () => {
    expect(assessChange(base, ctx()).status).toBe("fits");
    expect(assessChange(sundayMidday, ctx()).status).toBe("bends");
    // A whole-plan check (the page badge) flags an off-day workout even with no previous plan.
    expect(validatePlan(plan([run({ date: "2026-11-22" })]), { profile, busy: [], knownRange: RANGE, lockPreferences: true }).ok).toBe(false);
    expect(validatePlan(plan([run({ date: "2026-11-22" })]), { profile, busy: [], knownRange: RANGE }).ok).toBe(true);
  });

  it("calendar conflicts make an option invalid, not a bend", () => {
    const busy: BusyBlock[] = [{ id: "b", date: "2026-11-18", start: "18:00", end: "19:00", title: "Class", source: "simulated" }];
    expect(assessChange(base, ctx({ busy, previousPlan: plan([]) })).status).toBe("invalid");
  });

  it("ignores the model's claim and asks 'Only midday is free, 25 min. OK?' when a rule must bend", () => {
    const next = plan([legs(), upper({ start: "12:00", durationMin: 25, exercises: [{ exerciseId: "db_row", sets: 3, reps: "10 / side" }] }), run()]);
    const v = assessChange(next, ctx());
    expect(v.status).toBe("bends");
    expect(bendQuestion(v.bends, next)).toBe("Only midday is free, 25 min. OK?");
    expect(bendQuestion(assessChange(sundayMidday, ctx()).bends, sundayMidday)).toBe("Only Sunday midday is free, 25 min. OK?");
  });

  it("the AI gate keeps a bending option only as a question, and drops one that breaks a hard rule", () => {
    const req: AgentRequest = { profile, plan: base, history: [], blocked: [], notes: [], log: [], calendarPreset: "open", now: NOW, calendar: { busy: [], knownRange: RANGE } };
    const out = {
      alternatives: [
        // Says "fits" and "Wednesday 6 pm", but moves to Sunday midday and cuts it to 25 min.
        { kind: "shorter" as const, title: "Quick Wednesday session", summary: "Same as before, Wednesday at 6 pm.", tradeoffs: ["Fits your schedule perfectly."], operations: [{ op: "replace" as const, workoutId: "w-wed", date: "2026-11-22", start: "12:00", minutes: 25, category: "strength" as const, exerciseIds: ["db_row", "db_curl"], title: "Quick upper body" }] },
        { kind: "move" as const, title: "Move to Friday", summary: "Friday evening.", tradeoffs: [], operations: [{ op: "move" as const, workoutId: "w-wed", date: "2026-11-19", start: "18:00" }] },
        { kind: "skip" as const, title: "Rest", summary: "Rest.", tradeoffs: [], operations: [{ op: "skip" as const, workoutId: "w-wed" }] },
      ],
    };
    const { valid } = gate(out, req, base, ctx());
    const shorter = valid.find((a) => a.kind === "shorter")!;
    expect(shorter.fit).toBe("bends");
    expect(shorter.ask).toBe("Only Sunday midday is free, 25 min. OK?");
    expect(shorter.title).not.toMatch(/Wednesday/); // the model's title didn't match what's applied
    expect(shorter.summary).toMatch(/Sun, Nov 22 at 12 pm, 25 min/);
    expect(shorter.tradeoffs.join(" ")).not.toMatch(/Wednesday/);
    // Thursday isn't a training day, so "Move to Friday" (really Thursday) must ask too, with code-written text.
    const move = valid.find((a) => a.kind === "move")!;
    expect(move.fit).toBe("bends");
    expect(move.title).toBe("Move to Thu, Nov 19");
    expect(valid.find((a) => a.kind === "skip")?.fit).toBe("fits");
  });
});

describe("3. option text matches what gets applied", () => {
  it("formats dates as 'Wed, Nov 18' with the weekday derived from the date", () => {
    expect(formatDate("2026-11-18")).toBe("Wed, Nov 18");
    expect(humanizeDates("Moved to 2026-11-18.", 2026)).toBe("Moved to Wed, Nov 18.");
    expect(humanizeDates("On Wednesday 2026-11-19 at 6 pm", 2026)).toBe("On Thu, Nov 19 at 6 pm");
    expect(humanizeDates("Wednesday, Nov 19 works", 2026)).toBe("Thu, Nov 19 works");
  });

  it("describes operations from the plan, not the model", () => {
    expect(describeOperation(base, { op: "move", workoutId: "w-wed", date: "2026-11-20", start: "17:30" })).toBe(
      "Move Upper body strength to Fri, Nov 20 at 5:30 pm, 45 min.",
    );
    expect(describeOperation(base, { op: "skip", workoutId: "w-fri" })).toBe("Skip Easy run on Fri, Nov 20. No make-up session.");
  });

  it("accepts text that names the right day, time and length, and catches text that doesn't", () => {
    const ops = [{ op: "move" as const, workoutId: "w-wed", date: "2026-11-20", start: "18:00" }];
    expect(textMatchesOperations("Move Wednesday's session to Friday at 6 pm (45 min)", base, ops)).toBe(true);
    expect(textMatchesOperations("Move it to Saturday", base, ops)).toBe(false);
    expect(textMatchesOperations("Friday at 7 pm", base, ops)).toBe(false);
    expect(textMatchesOperations("A 25-minute version on Friday", base, ops)).toBe(false);
  });

  it("finalized options use generated summaries and drop mismatched model text", () => {
    const alt = finalizeAlternative(
      plan([legs(), upper()]),
      { id: "a", kind: "move", title: "Move to Saturday", summary: "Saturday 2026-11-21 at noon.", tradeoffs: ["Wednesday stays free.", "Back on 2026-11-20."], operations: [{ op: "move", workoutId: "w-wed", date: "2026-11-20", start: "17:00" }] },
      ctx({ previousPlan: plan([legs(), upper()]) }),
    )!;
    expect(alt.title).toBe("Move to Fri, Nov 20");
    expect(alt.summary).toBe("Move Upper body strength to Fri, Nov 20 at 5 pm, 45 min.");
    // "Wednesday stays free" names only the old day of a moved session, so it's dropped.
    expect(alt.tradeoffs).toEqual(["Back on Fri, Nov 20."]);
    expect(alt.fit).toBe("fits");
  });
});

describe("4. injuries are remembered", () => {
  it("detects an injury in chat and maps it to what Pivot avoids", () => {
    expect(detectInjury("my shin has been hurting after runs")).toEqual({ label: "Shin pain", tags: ["running", "high_impact"] });
    expect(detectInjury("I have shin splints")?.label).toBe("Shin splints");
    expect(detectInjury("tweaked my shoulder")?.tags).toEqual(["overhead"]);
    expect(detectInjury("I love running")).toBeNull();
    expect(detectInjury("my shin pain is healed now")).toBeNull();
  });

  it("saves it to the profile's limitations (shown in Preferences) once", () => {
    const injury = detectInjury("shin pain")!;
    const once = withInjury(profile, injury, "2026-11-18");
    expect(once.limitations).toBe("Shin pain (from coach chat, Wed, Nov 18)");
    expect(once.avoidTags).toEqual(["running", "high_impact"]);
    expect(withInjury(once, injury, "2026-11-19")).toEqual(once);
  });

  it("swaps conflicting exercises in upcoming workouts and keeps day, time and length", () => {
    const hurt = withInjury(profile, detectInjury("shin pain")!, WEEK);
    const hiit: Workout = { ...upper({ id: "w-hiit", date: "2026-11-21", category: "hiit", muscles: ["legs", "glutes"], exercises: [{ exerciseId: "squat_jump", sets: 4, reps: "10" }] }) };
    const before = plan([legs(), run(), hiit, run({ id: "w-old", date: "2026-11-15", status: "planned" })]);
    const { plan: after, swaps } = removeConflictingExercises(before, hurt, WEEK);
    const fri = after.workouts.find((w) => w.id === "w-fri")!;
    expect(fri.exercises.map((e) => e.exerciseId)).not.toContain("easy_run");
    expect([fri.date, fri.start, fri.durationMin]).toEqual(["2026-11-20", "18:00", 45]);
    expect(after.workouts.find((w) => w.id === "w-hiit")!.exercises.some((e) => e.exerciseId === "squat_jump")).toBe(false);
    expect(after.workouts.find((w) => w.id === "w-old")).toEqual(before.workouts.find((w) => w.id === "w-old")); // past: untouched
    expect(swaps.map((s) => s.workoutId).sort()).toEqual(["w-fri", "w-hiit"]);
    expect(describeSwaps(swaps)).toMatch(/Easy run/);
    const upcoming = { ...after, workouts: after.workouts.filter((w) => w.date >= WEEK) };
    expect(validatePlan(upcoming, { profile: hurt, busy: [], knownRange: RANGE }).violations.filter((v) => v.constraint === "avoided_activity")).toEqual([]);
  });
});

describe("5. ask before big changes", () => {
  it("asks before changing anything for a vague request that could rewrite a day", () => {
    const c = needsClarification("help me maintain lower-body mobility", base, WEEK)!;
    expect(c.request).toMatchObject({ kind: "emphasis", region: "lower", emphasis: "mobility" });
    expect(c.next?.text).toMatch(/lower-body mobility/);
    expect(c.next?.choices.map((x) => x.value)).toContain("remember");
  });

  it("lets small, specific requests through", () => {
    expect(needsClarification("move Wednesday's workout to 7pm", base, WEEK)).toBeNull();
    expect(needsClarification("I only have 20 minutes today", base, WEEK)).toBeNull();
    expect(needsClarification("skip my run", base, WEEK)).toBeNull();
    expect(needsClarification("I have a midterm Friday", base, WEEK)).toBeNull();
    expect(needsClarification("swap Friday's run for more core work", base, WEEK)).toBeNull();
  });
});

describe("6. guardrails", () => {
  it("flags two lower-body days back to back", () => {
    expect(isLowerBody(legs())).toBe(true);
    expect(isLowerBody(upper())).toBe(false);
    expect(isLowerBody(run())).toBe(false);
    const backToBack = plan([legs(), legs({ id: "w-tue", date: "2026-11-17" })]);
    expect(validatePlan(backToBack, { profile, busy: [], knownRange: RANGE }).violations.map((v) => v.constraint)).toContain("lower_body_spacing");
    // A re-plan that didn't create the pair isn't blamed for it.
    expect(validatePlan(backToBack, { profile, busy: [], knownRange: RANGE, previousPlan: backToBack }).violations.map((v) => v.constraint)).not.toContain("lower_body_spacing");
    // Moving a leg day next to another one is rejected.
    const moved = plan([legs(), legs({ id: "w-x", date: "2026-11-17" })]);
    expect(assessChange(moved, ctx({ previousPlan: plan([legs(), legs({ id: "w-x", date: "2026-11-20" })]) })).status).toBe("invalid");
  });

  it("the template planner never puts leg days back to back", () => {
    const legsOnly = { ...profile, targetMuscles: ["legs", "glutes"] as FitnessProfile["targetMuscles"], preferredDays: ["mon", "tue", "wed", "thu"] as FitnessProfile["preferredDays"], frequencyPerWeek: 4, workoutTypes: ["home"] as FitnessProfile["workoutTypes"] };
    const week = generateMockWeek({ profile: legsOnly, weekStart: WEEK, busy: [], now: NOW, createdAt: "x" });
    const dates = weekDates(WEEK);
    const legDays = week.workouts.filter(isLowerBody).map((w) => dates.indexOf(w.date));
    for (let i = 1; i < legDays.length; i++) expect(legDays[i] - legDays[i - 1]).toBeGreaterThan(1);
    expect(validatePlan(week, { profile: legsOnly, busy: [], knownRange: RANGE }).violations.filter((v) => v.constraint === "lower_body_spacing")).toEqual([]);
  });

  it("can't mark a workout done before its day", () => {
    expect(doneBlockedReason(upper(), "2026-11-17")).toBe("You can mark this done on Wed, Nov 18.");
    expect(doneBlockedReason(upper(), "2026-11-18")).toBeNull();
    expect(doneBlockedReason(upper(), "2026-11-19")).toBeNull();
  });
});
