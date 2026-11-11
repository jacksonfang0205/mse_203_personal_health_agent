/**
 * Regenerates evals/fixtures/baseline-plans.json from personas.json using the
 * deterministic template planner. Run only when personas change, and commit
 * the result: scenarios reference these workout ids, so baselines must stay
 * frozen between eval runs.
 *
 *   npx tsx evals/scripts/freeze-baselines.ts
 *   npx tsx evals/scripts/freeze-baselines.ts --missing-only   # add new personas, keep existing plans byte-for-byte
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateMockWeek } from "@/lib/planner/generate";
import { validatePlan } from "@/lib/validation";
import { EVALS_DIR, loadPersonas, personaBusy } from "../src/fixtures";

const { referenceWeek, personas } = loadPersonas();
const file = join(EVALS_DIR, "fixtures/baseline-plans.json");
const missingOnly = process.argv.includes("--missing-only");
const existing: Record<string, unknown> = missingOnly && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).plans : {};
const plans: Record<string, unknown> = { ...existing };

for (const persona of personas) {
  if (persona.id in existing) continue;
  const busy = personaBusy(persona, referenceWeek);
  const plan = generateMockWeek({
    profile: persona.profile,
    weekStart: referenceWeek.start,
    busy,
    createdAt: "2026-11-01T12:00:00.000Z",
  });
  const frozen = {
    ...plan,
    id: `baseline-${persona.id}`,
    generatedBy: "fixture" as const,
    workouts: plan.workouts.map((w, i) => ({ ...w, id: `${persona.id}-w${i + 1}` })),
  };
  const check = validatePlan(frozen, { profile: persona.profile, busy, knownRange: referenceWeek });
  if (!check.ok) {
    console.error(`Baseline for ${persona.id} fails validation:`, check.violations);
    process.exit(1);
  }
  plans[persona.id] = frozen;
  console.log(
    `${persona.id}: ${frozen.workouts.map((w) => `${w.id} ${w.date} ${w.start} ${w.durationMin}m ${w.title}`).join(" | ")}`,
  );
}

writeFileSync(
  file,
  JSON.stringify({ generatedWith: "mock_template planner (src/lib/planner/generate.ts)", plans }, null, 2) + "\n",
);
console.log("Wrote evals/fixtures/baseline-plans.json");
