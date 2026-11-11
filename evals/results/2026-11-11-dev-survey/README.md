# Eval results: dev and survey splits, 3 runs each (2026-11-11)

Runs after the rest-only scoring fix and the strength-category planner fix, on code at commit `1cc3cb2` plus those changes. Methodology: [EVAL_PLAN.md](../../../EVAL_PLAN.md).

## Setup

| | |
| --- | --- |
| Scenarios | dev: 26 synthetic scenarios; survey: 10 scenarios built from 5 anonymous survey responses (`evals/scenarios/survey.json`) |
| Model | `gpt-5.4-mini` via the Stanford AI API Gateway, for both LLM planners |
| Runs | 3 per LLM planner per split, one at a time, with the gateway's response cache bypassed so runs are independent; `rule_based` is deterministic, so once per split |
| Excluded | runs hit by the 2026-11-11 gateway outage (`fetch failed`, "authentication database unreachable"), and runs before the scoring fix |
| Raw files | every included run, as `.json` and `.csv`, in this folder |

## Dev split (26 scenarios x 3 runs)

| Measure | `pivot_agent` | `generic_llm` | `rule_based` |
| --- | --- | --- | --- |
| Scheduling feasibility | **72/72 (100%)** | 34/68 (50%) | 20/26 (77%) |
| Movement suitability | **67/72 (93%)** | 61/68 (90%) | 21/26 (81%) |
| Metric 1, all hard constraints | **67/72 (93%)** | 33/68 (49%) | 15/26 (58%) |
| Metric 1, errors counted as failures | **67/78 (86%)** | 33/78 (42%) | 15/26 (58%) |
| Metric 3, objective replanning | **44/66 (67%)** | 37/66 (56%) | 15/22 (68%) |
| Initial plans feasible | 12/12 | 12/12 | 4/4 |
| Offered options that are valid | **150/157 (96%)** | 120/179 (67%) | 45/68 (66%) |
| Request errors | 6 (format) | 10 (format) | 0 |

`pivot_agent` replanning failures: 9 did not say the request can't be met, 7 offered only rest, 6 request errors. All 12 of its constraint violations are `avoided_activity` (DEV-13, "nothing overhead": the agent has no field for restrictions stated only in a message).

`generic_llm` violations: 26 calendar conflicts, 25 scheduled in the past, 15 changed completed workouts, 11 avoided activities, 8 duration, 8 volume, 2 equipment, 1 not in the catalog.

## Survey split (10 scenarios x 3 runs)

| Measure | `pivot_agent` | `generic_llm` | `rule_based` |
| --- | --- | --- | --- |
| Scheduling feasibility | **27/29 (93%)** | 23/30 (77%) | 7/10 (70%) |
| Movement suitability | **29/29 (100%)** | 26/30 (87%) | 10/10 (100%) |
| Metric 1, all hard constraints | **27/29 (93%)** | 20/30 (67%) | 7/10 (70%) |
| Metric 3, objective replanning | 11/15 (73%) | **12/15 (80%)** | 5/5 (100%) |
| Initial plans feasible | 15/15 | 12/15 | 5/5 |
| Offered options that are valid | **45/47 (96%)** | 45/60 (75%) | 14/20 (70%) |

`pivot_agent`'s 2 violations are both SV-09 ("I have a meeting at 6 tomorrow morning"): it moved the walk to 06:30, but the scenario's ground truth assumes the meeting runs to 07:00, which the message never says. Its replanning misses are 3 rest-only answers (low-energy and caregiving cases) and 1 request error. `rule_based` passes replanning only because one of its options is valid; it ignores the message and offers the clashing times in the others.

## Caveats

- Small samples: 3 runs, 26 and 10 scenarios. Treat differences of a few scenarios as noise; the constraint gap between `pivot_agent` and `generic_llm` is large enough to matter.
- Dev scenarios are synthetic and written by the team; survey calendars and disruption times are assumed (see each scenario's `source`).
- Metrics check feasibility, not whether a plan suits the person's goals.

## Reproduce

```bash
npm run eval -- --planner pivot_agent --split dev
npm run eval -- --planner generic_llm --split survey
npm run eval:trace -- SV-09          # one scenario through every planner, step by step
```
