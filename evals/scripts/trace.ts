/**
 * Trace one scenario through planners and the scorer, step by step: what the
 * planner sees, what is hidden, every option it offers, the week that option
 * produces, and why it passes or fails.
 *
 *   npm run eval:trace -- SV-10
 *   npm run eval:trace -- DEV-13 --planner pivot_agent,generic_llm
 *
 * LLM planners need .env.local, like `npm run eval`. Nothing is written to disk.
 */
import { parseArgs } from "node:util";
import { applyOperations } from "@/lib/planner/alternatives";
import type { WeeklyPlan, Workout } from "@/lib/schemas";
import { validatePlan, type ValidationContext } from "@/lib/validation";
import { buildScenarioContext, loadBaselines, loadPersonas, loadScenarios } from "../src/fixtures";
import { PLANNERS } from "../src/planners";
import { scoreScenario } from "../src/score";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no env file: LLM planners report that AI isn't configured
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { planner: { type: "string", default: "rule_based,generic_llm,pivot_agent" } },
});
const id = positionals[0];
const scenario = loadScenarios("all")
  .concat(loadScenarios("survey"))
  .find((s) => s.id === id);
if (!scenario) {
  console.error(`Usage: npm run eval:trace -- <scenario id, e.g. SV-10 or DEV-13> [--planner a,b]`);
  process.exit(1);
}

const workout = (w: Workout) =>
  `${w.id} ${w.date} ${w.start} ${w.durationMin}m "${w.title}" ${w.status} [${w.exercises.map((e) => e.exerciseId).join(", ")}]`;
const same = (a: Workout, b?: Workout) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const s = scenario!;
  const { referenceWeek, personas } = loadPersonas();
  const { plans } = loadBaselines();
  const { persona, plan, visibleBusy, trueBusy } = buildScenarioContext(s, personas, plans, referenceWeek);
  const isPlan = s.expected.outcome === "plan";
  const p = persona.profile;

  console.log(`\n${s.id} · ${s.category} · ${s.title}`);
  if (s.source) console.log(`Source: respondent ${s.source.respondent}${s.source.message ? `, message ${s.source.message}` : ""}`);
  console.log(`Now: ${s.now.date} ${s.now.time}`);
  console.log(`Message: "${s.userMessage}"`);
  console.log(
    `Profile: ${p.sessionMinutes} min max, ${p.frequencyPerWeek}/week, equipment [${p.equipment.join(", ") || "none"}], avoids tags [${p.avoidTags.join(", ")}]${p.avoidExerciseIds.length ? ` and ${p.avoidExerciseIds.length} exercises` : ""}`,
  );
  if (!isPlan) console.log(`Current week:\n  ${plan.workouts.map(workout).join("\n  ")}`);
  console.log(`Calendar the planner sees:\n  ${visibleBusy.map((b) => `${b.date} ${b.start}-${b.end} ${b.title}`).join("\n  ")}`);
  console.log(`Hidden ground truth: ${JSON.stringify(s.groundTruth)}`);
  console.log(`Expected: ${JSON.stringify(s.expected)}`);

  const ctx: ValidationContext = {
    profile: p,
    busy: trueBusy,
    knownRange: referenceWeek,
    now: s.now,
    previousPlan: isPlan ? undefined : plan,
    dateLimits: s.groundTruth.dateLimits,
    equipmentAvailable: s.groundTruth.equipmentAvailable,
    extraAvoidTags: s.groundTruth.extraAvoidTags,
  };
  const input = {
    scenarioId: s.id,
    userMessage: s.userMessage,
    now: s.now,
    weekStart: referenceWeek.start,
    profile: p,
    calendar: { busy: visibleBusy, knownRange: referenceWeek },
  };

  for (const pid of values.planner!.split(",")) {
    const planner = PLANNERS[pid];
    if (!planner) {
      console.log(`\n== ${pid}: unknown planner`);
      continue;
    }
    console.log(`\n== ${pid}`);
    try {
      const out = isPlan ? await planner.generatePlan(input) : await planner.replan({ ...input, plan });
      const score = scoreScenario(s, out, ctx, plan);
      if (out.kind === "plan") {
        console.log(`  Proposed week:\n    ${out.plan.workouts.map(workout).join("\n    ")}`);
        const v = validatePlan(out.plan, ctx).violations;
        console.log(`  ${v.length ? `FAIL: ${v.map((x) => `${x.constraint}: ${x.message}`).join(" / ")}` : "PASS: no violations"}`);
      } else {
        const pr = out.proposal;
        console.log(`  Understood: ${JSON.stringify(pr.understood)}`);
        if (pr.infeasibleReason) console.log(`  Says it can't be done: ${pr.infeasibleReason}`);
        if (out.responseText) console.log(`  Note: ${out.responseText}`);
        pr.alternatives.forEach((a, i) => {
          const after: WeeklyPlan = applyOperations(plan, a.operations);
          const changed = after.workouts.filter((w) => !same(w, plan.workouts.find((x) => x.id === w.id)));
          const r = score.alternatives[i];
          console.log(`  Option ${i + 1} (${a.kind}) "${a.title}"`);
          console.log(`    Changes: ${changed.map(workout).join(" ; ") || "none"}`);
          console.log(
            `    ${r.valid ? "VALID" : "INVALID"}${r.violations.length ? `: ${r.violations.map((x) => `${x.constraint}: ${x.message}`).join(" / ")}` : ""} · ${r.resolves ? "resolves the disruption" : `does not resolve (${[...r.unresolved.map((x) => `${x} unchanged`), ...r.disturbed.map((x) => `${x} disturbed`)].join(", ")})`}`,
          );
        });
      }
      console.log(`  SCORE: constraints ${score.constraintPass === null ? "n/a" : score.constraintPass ? "PASS" : "FAIL"} · replanning ${score.feasible ? "PASS" : "FAIL"} (${score.feasibleReason})`);
    } catch (e) {
      console.log(`  ERROR: ${(e as Error).message}`);
    }
  }
}

main();
