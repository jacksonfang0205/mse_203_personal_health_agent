# Pivot

Fitness that fits your life. An AI workout planner that adapts when your week changes. Built for Stanford MS&E 203.

- Architecture and roadmap: [PLAN.md](PLAN.md)
- Evaluation methodology: [EVAL_PLAN.md](EVAL_PLAN.md)
- Task checklist: [TASKS.md](TASKS.md)
- Eval harness: [evals/README.md](evals/README.md)

## Run locally

Requires Node 20.19+ (developed on Node 26). No API keys are needed for Phase 1.

```bash
npm install
npm run dev        # http://localhost:3000
```

## Checks

```bash
npm run lint
npm run typecheck
npm test           # Vitest: validation, planner, and eval fixture integrity
npm run eval -- --planner rule_based   # eval harness on the dev split
npm run build
```

## Phase 1 status

Workout plans and Life Happens suggestions are produced by deterministic, rule-based code and labeled as sample data in the UI. The calendar is simulated. Live AI planning arrives in Phase 2.

User data is stored only in your browser's localStorage. Reset it from Preferences → Study tools.
