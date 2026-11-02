/**
 * Eval runner.
 *
 *   npm run eval -- --planner rule_based --split dev
 *   npm run eval -- --planner rule_based --split heldout --heldout-ok
 *
 * Writes evals/results/runs/<runId>.json and .csv and prints a summary.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { ValidationContext } from "@/lib/validation";
import { buildScenarioContext, EVALS_DIR, loadBaselines, loadPersonas, loadScenarios, type Scenario } from "./fixtures";
import { PLANNERS, type PlannerOutput, type Usage } from "./planners";
import { scoreScenario, type ScenarioScore } from "./score";

// LLM planners read their key and model from .env.local, like the app.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no env file: LLM planners will report that AI isn't configured
}

const { values: args } = parseArgs({
  options: {
    planner: { type: "string", default: "rule_based" },
    split: { type: "string", default: "dev" },
    "heldout-ok": { type: "boolean", default: false },
    only: { type: "string" },
  },
});

const planner = PLANNERS[args.planner!];
if (!planner) {
  console.error(`Unknown planner "${args.planner}". Available: ${Object.keys(PLANNERS).join(", ")}`);
  process.exit(1);
}
const split = args.split as "dev" | "heldout" | "all";
if (!["dev", "heldout", "all"].includes(split)) {
  console.error(`--split must be dev, heldout, or all`);
  process.exit(1);
}
if (split !== "dev" && !args["heldout-ok"]) {
  console.error("Held-out scenarios are for checkpoint evaluations only. Re-run with --heldout-ok to confirm.");
  process.exit(1);
}

type Pricing = Record<string, { inputPerMTok: number; outputPerMTok: number }>;
function loadPricing(): Pricing {
  const file = join(EVALS_DIR, "pricing.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")).models ?? {}) : {};
}

function cost(usage: Usage[] | undefined, pricing: Pricing): number | null {
  if (!usage?.length) return null;
  let total = 0;
  for (const u of usage) {
    const p = pricing[u.model];
    if (!p) return null; // unknown price: report null rather than guess
    total += (u.inputTokens / 1e6) * p.inputPerMTok + (u.outputTokens / 1e6) * p.outputPerMTok;
  }
  return total;
}

function gitCommit(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

const percentile = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

interface Row {
  id: string;
  split: Scenario["split"];
  category: Scenario["category"];
  personaId: string;
  expectedOutcome: Scenario["expected"]["outcome"];
  status: "ok" | "error";
  error?: string;
  latencyMs: number;
  alternativesOffered: number;
  score?: ScenarioScore;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  responseText?: string;
}

async function main() {
  const { referenceWeek, personas } = loadPersonas();
  const { plans: baselines } = loadBaselines();
  let scenarios = loadScenarios(split);
  if (args.only) scenarios = scenarios.filter((s) => args.only!.split(",").includes(s.id));
  const pricing = loadPricing();
  const startedAt = new Date().toISOString();
  const runId = `${startedAt.replace(/[:.]/g, "-")}_${planner.id}_${split}`;
  const rows: Row[] = [];

  for (const scenario of scenarios) {
    const { persona, plan, visibleBusy, trueBusy } = buildScenarioContext(scenario, personas, baselines, referenceWeek);
    const input = {
      scenarioId: scenario.id,
      userMessage: scenario.userMessage,
      now: scenario.now,
      weekStart: referenceWeek.start,
      profile: persona.profile,
      calendar: { busy: visibleBusy, knownRange: referenceWeek },
    };
    const gt = scenario.groundTruth;
    const isPlan = scenario.expected.outcome === "plan";
    const ctx: ValidationContext = {
      profile: persona.profile,
      busy: trueBusy,
      knownRange: referenceWeek,
      now: scenario.now,
      previousPlan: isPlan ? undefined : plan,
      dateLimits: gt.dateLimits,
      equipmentAvailable: gt.equipmentAvailable,
      extraAvoidTags: gt.extraAvoidTags,
    };

    const t0 = performance.now();
    let output: PlannerOutput | undefined;
    let error: string | undefined;
    try {
      output = isPlan ? await planner.generatePlan(input) : await planner.replan({ ...input, plan });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const latencyMs = Math.round(performance.now() - t0);

    const usage = output?.usage;
    rows.push({
      id: scenario.id,
      split: scenario.split,
      category: scenario.category,
      personaId: scenario.personaId,
      expectedOutcome: scenario.expected.outcome,
      status: output ? "ok" : "error",
      error,
      latencyMs,
      alternativesOffered: output?.kind === "proposal" ? output.proposal.alternatives.length : output ? 1 : 0,
      score: output ? scoreScenario(scenario, output, ctx, plan) : undefined,
      inputTokens: usage?.reduce((s, u) => s + u.inputTokens, 0) ?? 0,
      outputTokens: usage?.reduce((s, u) => s + u.outputTokens, 0) ?? 0,
      costUsd: cost(usage, pricing),
      responseText: output?.responseText,
    });
  }

  // ---------- Summary ----------
  const evaluated = rows.filter((r) => r.score?.constraintPass !== null && r.score?.constraintPass !== undefined);
  const disruption = rows.filter((r) => r.expectedOutcome !== "plan");
  const costs = rows.map((r) => r.costUsd);
  const summary = {
    scenarios: rows.length,
    errors: rows.filter((r) => r.status === "error").length,
    metric1_constraintAdherence: {
      passed: evaluated.filter((r) => r.score!.constraintPass).length,
      evaluated: evaluated.length,
      noProposal: rows.length - evaluated.length,
      rate: evaluated.length ? evaluated.filter((r) => r.score!.constraintPass).length / evaluated.length : null,
      target: 0.9,
    },
    metric3_objectiveReplanning: {
      feasible: disruption.filter((r) => r.score?.feasible).length,
      total: disruption.length,
      rate: disruption.length ? disruption.filter((r) => r.score?.feasible).length / disruption.length : null,
      target: 0.8,
      note: "Objective feasibility only. User acceptance is measured separately in user studies.",
    },
    initialPlans: {
      feasible: rows.filter((r) => r.expectedOutcome === "plan" && r.score?.feasible).length,
      total: rows.filter((r) => r.expectedOutcome === "plan").length,
    },
    latencyMs: { median: median(rows.map((r) => r.latencyMs)), p90: percentile(rows.map((r) => r.latencyMs), 0.9) },
    tokens: { input: rows.reduce((s, r) => s + r.inputTokens, 0), output: rows.reduce((s, r) => s + r.outputTokens, 0) },
    estimatedCostUsd: costs.every((c) => c !== null) && costs.length ? costs.reduce((s, c) => s! + c!, 0) : null,
    byCategory: Object.fromEntries(
      [...new Set(rows.map((r) => r.category))].map((c) => {
        const rs = rows.filter((r) => r.category === c);
        return [c, { total: rs.length, constraintPass: rs.filter((r) => r.score?.constraintPass).length, feasible: rs.filter((r) => r.score?.feasible).length }];
      }),
    ),
  };

  const report = {
    runId,
    startedAt,
    planner: { id: planner.id, description: planner.description },
    split,
    gitCommit: gitCommit(),
    node: process.version,
    syntheticData: true,
    summary,
    results: rows,
  };

  const outDir = join(EVALS_DIR, "results", "runs");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${runId}.json`), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, `${runId}.csv`), toCsv(rows));

  // ---------- Console ----------
  const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(0)}%`);
  console.log(`\nPivot eval · planner=${planner.id} · split=${split} · ${rows.length} SYNTHETIC scenarios\n`);
  for (const r of rows) {
    const m1 = r.score?.constraintPass === null ? "  -  " : r.score?.constraintPass ? " PASS" : " FAIL";
    const m3 = r.expectedOutcome === "plan" ? "     " : r.score?.feasible ? " FEAS" : " ----";
    console.log(
      `${r.id.padEnd(7)} ${r.category.padEnd(24)} M1${m1}  M3${m3}  ${String(r.latencyMs).padStart(5)}ms  ${r.error ?? r.score?.feasibleReason ?? ""}`,
    );
  }
  const m1 = summary.metric1_constraintAdherence;
  const m3 = summary.metric3_objectiveReplanning;
  console.log(
    `\nMetric 1 constraint adherence: ${m1.passed}/${m1.evaluated} (${pct(m1.rate)}), ${m1.noProposal} with nothing proposed · target 90%`,
  );
  console.log(`Metric 3 objective replanning: ${m3.feasible}/${m3.total} (${pct(m3.rate)}) · target 80%`);
  console.log(`Initial plans feasible: ${summary.initialPlans.feasible}/${summary.initialPlans.total}`);
  console.log(`Latency median ${summary.latencyMs.median} ms, p90 ${summary.latencyMs.p90} ms`);
  console.log(
    `Tokens in/out: ${summary.tokens.input}/${summary.tokens.output} · est. cost: ${summary.estimatedCostUsd === null ? "n/a" : `$${summary.estimatedCostUsd.toFixed(4)}`}`,
  );
  console.log(`\nWrote evals/results/runs/${runId}.{json,csv}`);
}

function toCsv(rows: Row[]): string {
  const header = [
    "id",
    "split",
    "category",
    "persona",
    "expected_outcome",
    "status",
    "constraint_pass",
    "feasible",
    "feasible_reason",
    "rest_only",
    "alternatives_offered",
    "violations",
    "latency_ms",
    "input_tokens",
    "output_tokens",
    "cost_usd",
  ];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.id,
      r.split,
      r.category,
      r.personaId,
      r.expectedOutcome,
      r.status,
      r.score?.constraintPass ?? "",
      r.score?.feasible ?? "",
      r.error ?? r.score?.feasibleReason ?? "",
      r.score?.restOnly ?? "",
      r.alternativesOffered,
      r.score?.alternatives.flatMap((a) => a.violations.map((v) => `${a.id}:${v.constraint}`)).join("; ") ?? "",
      r.latencyMs,
      r.inputTokens,
      r.outputTokens,
      r.costUsd ?? "",
    ]
      .map(esc)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
