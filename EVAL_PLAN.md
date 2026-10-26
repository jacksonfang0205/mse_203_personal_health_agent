# Pivot: Evaluation Plan

Evaluation is as important to this project as the prototype. This plan defines what we measure, how we measure it, and how we keep the results honest. The harness lives in [`evals/`](evals/README.md).

## Principles

- Deterministic code checks objective constraints. The LLM never grades its own schedule feasibility.
- Objective feasibility and subjective acceptance are scored separately.
- Every scenario and persona is labeled synthetic. Study participants and their results are never fabricated.
- Dev and held-out scenarios stay separate. Prompts are tuned on dev only.
- Every run records the planner, git commit, latency, tokens, and cost (when pricing is configured), and is exported as JSON and CSV.

## Conditions compared

| Condition | Planner id | Context available |
| --- | --- | --- |
| A. Manual planning | (user study) | The participant's own calendar and preferences |
| B. Generic LLM | `generic_llm` (Phase 2) | Same profile, plan, and calendar pasted into one prompt. No tools, no history, single shot. |
| C. Pivot agent | `pivot_agent` (Phase 2) | Tools for profile, plan, history, calendar, catalog, and validation |
| Floor | `noop` | Nothing. Proposes nothing. Harness sanity check. |
| Rule-based | `rule_based` | Structured state, ignores the message. Shows how much the message adds. |

B and C receive equivalent user information. The variables under test are tools, validation feedback, and memory. A second B variant without the calendar (`generic_llm_no_calendar`) can isolate the value of calendar access if we have time.

## Metric 1: Constraint adherence

**Target:** at least 90% of evaluated scenarios satisfy every applicable hard constraint.

A scenario passes when every plan or alternative the planner proposes passes `validatePlan` against the ground-truth context. Scenarios where the planner proposes nothing are reported separately as "no proposal" and excluded from the rate, since an empty answer trivially satisfies constraints (Metric 3 catches that failure).

Hard constraints (`src/lib/validation.ts`):

| Id | Check |
| --- | --- |
| `schema` | Plan parses against the WeeklyPlan schema |
| `catalog_grounded` | Every exercise id exists in the catalog |
| `calendar_conflict` | No planned workout overlaps a busy block or another workout |
| `duration_limit` | Each session fits the profile cap and any per-date limit; listed exercises fit the slot (15% tolerance) |
| `equipment` | All required equipment is available (profile or scenario override) |
| `avoided_activity` | No avoided tag or exercise id, including restrictions stated in the scenario |
| `completed_preserved` | Completed workouts are byte-for-byte unchanged |
| `grounded_availability` | Workouts fall inside the calendar's known range and 06:00 to 22:00 |
| `no_volume_spike` | No more sessions or weekly minutes than the larger of the profile or the previous plan, no stacking two sessions in a day, no sets inflated above catalog default + 1 |
| `no_past_scheduling` | Nothing new or moved is placed before "now" |

Ground truth includes facts the planner may only learn from the message, such as a meeting that is not on the calendar. That is deliberate: ignoring the message should cost points.

## Metric 2: Planning efficiency

**Target:** at least 30% lower median planning time than manual scheduling.

Instrumentation (`src/lib/telemetry.ts`) logs timestamped events locally: `onboarding_started`, `onboarding_completed` (with duration), `life_happens_opened`, `life_happens_submitted`, `alternative_accepted` (with time since opening), `alternatives_rejected`, and more. Facilitators export the log from Preferences → Study tools.

Protocol, to run in Week 3 and 4:

1. Recruit participants from the target group (busy students and young professionals). Get consent, as the course requires.
2. Give each participant the same written disruption task, for example "You have a midterm Thursday and lost 30 minutes on Friday; adjust your week."
3. **Manual condition:** they adjust a printed or spreadsheet plan using a calendar. A facilitator times start to "done".
4. **Pivot condition:** same task in the app. Time runs from `life_happens_opened` to `alternative_accepted`.
5. Counterbalance the order across participants, and use different but equivalent tasks per condition to limit learning effects.
6. Report medians, the interquartile range, and n. With small n, report raw times rather than significance claims.

No baseline numbers exist yet. They come only from these sessions.

## Metric 3: Successful replanning

**Target:** at least 80% of disruption scenarios produce a feasible, user-acceptable alternative.

**Objective half (automated, now):**

- Outcome `replan`: at least one alternative that passes every hard constraint, changes every `mustChange` workout, leaves every `mustKeep` workout untouched, and is not just "skip". Rest-only answers are reported separately.
- Outcome `infeasible`: the planner sets `infeasibleReason`, proposes nothing that violates constraints, and disturbs no `mustKeep` workout.

**Subjective half (Phase 3):**

- A rubric scored 1 to 5 by two team members, blind to the condition: addresses what the user said, tradeoffs are honest (no claims of equivalent benefit), respects goals, no medical advice, explanation is clear.
- In user tests: whether the participant accepted an alternative, which kind, and a single "Would you use this?" rating. Accepted and rejected decisions are already logged as `ChangeRecord`s.
- A scenario counts toward the 80% only if it is objectively feasible and its best alternative averages 4 or higher on the rubric.

## Scenarios

37 synthetic scenarios over 5 synthetic personas and one reference week (Mon 2026-11-02 to Sun 2026-11-08):

| Category | Dev | Held-out |
| --- | --- | --- |
| initial_plan | 4 | 2 |
| unexpected_meeting | 4 | 1 |
| missed_workout | 2 | 1 |
| reduced_time | 3 | 1 |
| equipment_change | 2 | 0 |
| activity_restriction | 3 | 1 |
| conflicting_preferences | 2 | 1 |
| no_feasible_window | 1 | 1 |
| preserve_completed | 2 | 1 |
| multi_change | 3 | 2 |
| **Total** | **26** | **11** |

Each scenario specifies the persona, the current moment, status changes to the frozen baseline plan, the user message, the ground truth (added busy time and whether it is on the calendar, per-date minute limits, equipment overrides, extra restrictions), and the expected outcome.

## Leakage controls

- Held-out scenarios live in `evals/scenarios/heldout.json`. Nobody reads them while writing prompts or tool descriptions.
- The runner refuses `--split heldout` without `--heldout-ok`.
- A test asserts the splits are disjoint and use distinct messages.
- Baseline plans are frozen in `evals/fixtures/baseline-plans.json` so changes to the template planner don't shift scenarios.
- Before the final evaluation, add 5 to 10 fresh held-out scenarios written by a teammate who hasn't seen the prompts.

## Reporting

Each run writes `evals/results/runs/<timestamp>_<planner>_<split>.json` (full detail) and `.csv` (one row per scenario). Final reporting will show, per condition: Metric 1 rate, Metric 3 objective rate, rubric scores, median and p90 latency, tokens, and estimated cost, broken down by category, with failure examples.

## Current status

The harness works end to end with the `noop` and `rule_based` planners. Those runs only validate the harness. They are not results for Pivot's AI, which doesn't exist yet.
