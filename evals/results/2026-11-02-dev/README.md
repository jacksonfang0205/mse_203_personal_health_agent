# Eval results: first LLM runs, dev split (2026-11-02)

The first runs of Pivot's AI against the harness in [`evals/`](../../README.md), as defined in [EVAL_PLAN.md](../../../EVAL_PLAN.md). **These are early, single-run results on synthetic dev scenarios.** The held-out split has not been run.

## Setup

| | |
| --- | --- |
| Scenarios | 26 synthetic dev scenarios (`evals/scenarios/dev.json`), 5 synthetic personas, reference week 2026-11-02 to 2026-11-08 |
| Code | commit `002304a` (merged to `main` in #1) |
| Model | `gpt-5.4-mini` via the Stanford AI API Gateway, for both LLM planners |
| Runs | one run per planner, 2026-11-02 |
| Raw files | `rule_based`, `generic_llm` and `pivot_agent`, each as `.json` (full detail and every violation) and `.csv` (one row per scenario), in this folder |

The planners compared:

- **`rule_based`**: the deterministic template planner and rule-based alternatives. It ignores the user's message, so it shows how much reading the message adds.
- **`generic_llm`** (condition B): one prompt with the same profile, calendar, current plan, message, full exercise catalog and the same written rules. No validation, no repair, no pre-filtering.
- **`pivot_agent`** (condition C): the app's real agent code. The model only sees exercises the user can do and precomputed free windows. Server code rebuilds every workout from the catalog, repairs start times, runs every check, fixes workouts the change knocks out, retries once with the violations, and falls back to rule-based options.

Both LLM planners use the same model, so the difference between them is the code around the model.

## Headline results

| Planner | Metric 1: constraint adherence (target 90%) | Metric 3: objective replanning (target 80%) | Initial plans feasible | Errors | Median / p90 latency | Tokens in / out | Est. cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `rule_based` | 15/26 (58%) | 15/22 (68%) | 4/4 | 0 | 0 / 1 ms | 0 | $0 |
| `generic_llm` | **9/22 (41%)** | 15/22 (68%) | 3/4 | 4 | 21.7 / 33.0 s | 119,500 / 12,580 | ~$0.07 |
| `pivot_agent` | **23/24 (96%)** | **16/22 (73%)** | 4/4 | 2 | 23.0 / 30.8 s | 78,263 / 9,288 | ~$0.05 |

How to read this:

- **Metric 1** passes a scenario only if *every* plan or option the planner offers passes all hard checks. Scenarios where the planner errored or proposed nothing are excluded from the rate and counted under Errors.
- **Metric 3** passes when at least one valid option resolves the disruption without touching workouts that should stay. For "can't be done" scenarios, it must say so instead.
- **Why Metric 3 is close but Metric 1 isn't:** `generic_llm` often finds one good option but offers broken ones next to it. A user could pick a broken one. Pivot only shows options that pass.
- **Cost** uses the gateway's education rate for gpt-5.4-mini, $0.375 per million input tokens and $2.25 per million output tokens (see `evals/pricing.json`). The price was added after these runs, so the raw files show cost as `null`; the figures above are computed from their token counts.

## By category

Pass counts for Metric 1 / Metric 3. For `initial_plan` scenarios, the second number counts feasible plans.

| Category | n | `rule_based` | `generic_llm` | `pivot_agent` |
| --- | --- | --- | --- | --- |
| initial_plan | 4 | 4 / 4 | 3 / 3 | 4 / 4 |
| unexpected_meeting | 4 | 2 / 4 | 2 / 4 | 4 / 4 |
| missed_workout | 2 | 2 / 2 | 0 / 2 | 2 / 2 |
| reduced_time | 3 | 2 / 3 | 1 / 3 | 2 / 2 |
| equipment_change | 2 | 0 / 1 | 0 / 2 | 2 / 2 |
| activity_restriction | 3 | 0 / 1 | 0 / 1 | 2 / 2 |
| conflicting_preferences | 2 | 2 / 1 | 0 / 0 | 1 / 0 |
| no_feasible_window | 1 | 1 / 0 | 0 / 0 | 1 / 0 |
| preserve_completed | 2 | 2 / 1 | 1 / 1 | 2 / 1 |
| multi_change | 3 | 0 / 2 | 2 / 2 | 3 / 3 |

## Failures by category

### `generic_llm`

Rule violations across all offered plans and options:

| Check | Count | Example |
| --- | --- | --- |
| `no_past_scheduling` | 9 | DEV-07: "Easy run" is scheduled for 2026-11-03 18:30, which has already passed. |
| `calendar_conflict` | 7 | DEV-06: "Easy run" and "Yoga flow" overlap on 2026-11-05. |
| `no_volume_spike` | 4 | DEV-06: 2 workouts stacked on 2026-11-05. |
| `equipment` | 4 | DEV-10: "Upper body strength" needs barbell, bench, dumbbells, kettlebell. |
| `completed_preserved` | 3 | DEV-23: Completed workout "Lower body strength" was modified. |
| `avoided_activity` | 2 | DEV-13: "Upper body strength" includes Dumbbell shoulder press (overhead), which you asked to avoid. |
| `schema` | 1 | DEV-03: an exercise was given 0 minutes. |

Errors (4): an invalid option type in the output (DEV-12, DEV-19, DEV-24), and a 90-second timeout (DEV-14).

Did not acknowledge an impossible request: DEV-16, DEV-23.

### `pivot_agent`

| # | Failure | Scenarios | Likely cause | Fix to try |
| --- | --- | --- | --- | --- |
| 1 | Output didn't match the expected format | DEV-14 (an option with no operations), DEV-22 (a missing list) | The output schema is stricter than the model's answers | Relax the schema (allow empty or missing lists) and drop bad options instead of failing the whole request |
| 2 | A restriction stated only in the message got through | DEV-24: 5 `avoided_activity` violations, e.g. "Standing mobility" includes Thoracic open books (floor work) | The agent's output has no field for new restrictions from the message, so the checks never learn about them | Add an `avoid_tags` field to the Life Happens output and pass it to the checks as `extraAvoidTags` |
| 3 | Didn't say a request can't be met | DEV-16 (no feasible window), DEV-23 (preserve completed) | The model offers something instead of saying no; the repair and fallback steps also try to produce options | Prompt and code changes so a clear "nothing fits" wins when no valid option resolves the disruption |
| 4 | Valid options that don't resolve the disruption | DEV-15 (conflicting preferences) | The options pass the checks but don't change the workout the scenario requires | Look at the scenario's `mustChange` and the agent's understanding of the conflict |

The one Metric 1 failure is #2. Failures #1, #3 and #4 cost Metric 3.

## Caveats

- **One run, dev split only.** LLM output varies between runs, so treat small differences (e.g. 73% vs 68%) as noise until repeated. The 96% vs 41% gap is large enough to be meaningful.
- **Synthetic scenarios.** Personas and messages are made up and labelled as such. No real users are involved.
- **Objective scoring only.** Metric 3's subjective half (the rubric and user acceptance) and Metric 2 (planning time) are not measured yet.
- **Single model.** Both LLM planners use gpt-5.4-mini. A larger model may close some of the gap; that comparison hasn't been run.
- **Design differs from PLAN.md.** `pivot_agent` uses one structured LLM call with a deterministic gate and one repair round, not the tool-calling loop in PLAN.md. These results support the simpler design, but the team should confirm it.

## Reproduce

```bash
cp .env.example .env.local   # LLM_PROVIDER, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
npm run eval -- --planner rule_based
npm run eval -- --planner generic_llm
npm run eval -- --planner pivot_agent
LLM_MODEL=gpt-5.4 npm run eval -- --planner generic_llm   # another model; add its price to evals/pricing.json
```

Each run writes `evals/results/runs/<timestamp>_<planner>_dev.{json,csv}`, which git ignores. Copy runs worth keeping into a dated folder like this one.
