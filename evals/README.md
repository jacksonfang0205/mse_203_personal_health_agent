# Pivot evals

All data here is **synthetic**. Methodology: [../EVAL_PLAN.md](../EVAL_PLAN.md).

## Run

```bash
npm run eval -- --planner rule_based            # dev split (default)
npm run eval -- --planner noop
npm run eval -- --planner rule_based --only DEV-04,DEV-19
npm run eval -- --planner rule_based --split heldout --heldout-ok   # checkpoints only
npm test                                        # includes fixture integrity tests
```

Results go to `results/runs/<timestamp>_<planner>_<split>.json` and `.csv`. That folder is git-ignored; copy runs you want to keep into `results/archive/` and commit them.

## Layout

| Path | Contents |
| --- | --- |
| `fixtures/personas.json` | 5 synthetic personas: profile plus recurring calendar |
| `fixtures/baseline-plans.json` | Frozen starting plans. Regenerate with `npm run eval:freeze-baselines` only when personas change, then check that scenario ids still match. |
| `scenarios/dev.json` | 26 dev scenarios. OK to read while iterating. |
| `scenarios/heldout.json` | 11 held-out scenarios. Don't read them while writing prompts. |
| `src/fixtures.ts` | Schemas, loaders, and the planner-visible vs ground-truth context split |
| `src/planners.ts` | `Planner` interface plus `noop` and `rule_based` |
| `src/score.ts` | Metric 1 and Metric 3 (objective) scoring |
| `src/run.ts` | CLI runner and JSON/CSV export |
| `pricing.json` | Per-model token prices. Empty on purpose; fill in from the provider's pricing page. |

## Adding a planner

Implement `Planner` (`generatePlan` and `replan`), return `usage` with token counts, and register it in `PLANNERS`. Planners receive only `visibleBusy`, meaning the calendar as a tool would see it. Events mentioned only in the message are ground truth the planner has to pick up from the text.

## Adding a scenario

Copy an existing entry and give it the next id in the right file (`DEV-` or `HO-`). Reference workout ids from `baseline-plans.json`. Mark workouts that have already happened as `completed` in `setup`. Then run `npm test`: the integrity tests catch bad references, dates outside the week, and completed workouts in the future.
