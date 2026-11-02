# Pivot: Task Checklist

Ordered by priority within each week. See [PLAN.md](PLAN.md) and [EVAL_PLAN.md](EVAL_PLAN.md).

## Week 1: Foundations (Phase 1)

- [x] Inspect the project and document the architecture (PLAN.md)
- [x] Zod schemas for profile, catalog, workouts, plans, calendar, proposals, change history
- [x] Curated exercise catalog with equipment, level, and avoid tags
- [x] Calendar adapter interface plus simulated provider with three presets
- [x] Deterministic validation (10 hard constraints, 3 soft warnings)
- [x] Template planner and rule-based alternatives, clearly labeled as non-AI
- [x] Design system (tokens, Fraunces + Geist, cards, chips, badges)
- [x] Landing page
- [x] Six-step onboarding
- [x] Editable preferences page, with calendar preset and study tools
- [x] Weekly dashboard: day columns, cards, detail dialog, statuses, progress, change history
- [x] Life Happens panel (rule-based preview with approve and decline)
- [x] localStorage persistence behind a repository interface
- [x] Local timing telemetry with JSON export
- [x] Eval harness: personas, frozen baselines, 37 scenarios, scorer, runner, JSON/CSV export
- [x] Unit tests for validation, planner, and fixture integrity
- [ ] **Team:** manual browser QA pass (see the "What to test" list in the Phase 1 handoff)
- [ ] **Team:** review scenario ground truth; add or adjust scenarios

## Week 2: Agent (Phase 2)

- [ ] Choose model and provider; add `ANTHROPIC_API_KEY` to `.env.local` and Vercel
  - Done locally: Stanford AI API Gateway with `gpt-5.4-mini`, configured through `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL` (see `.env.example`). **Still to do:** set these in Vercel for Production and Preview, and switch from a personal key to the team key.
- [x] `POST /api/life-happens` route handler (server only; validates the request snapshot with Zod)
- [ ] Agent loop with the read tools, `build_workout`, `validate_workout_plan`, and `propose_schedule_changes`
  - Built differently: one structured LLM call per request, with the read and validation steps done in code before and after it (`src/lib/agent/`). The first eval results support this design. **Team to decide:** keep it and update PLAN.md, or build the tool loop.
- [ ] Server-side validation gate and repair loop (max 2 rounds)
  - Gate done for plans and Life Happens. Repair loop has 1 round (Life Happens only), not 2.
- [x] Wire the Life Happens UI to the API, with loading and error states, and keep the rule-based fallback when there is no API key
- [x] LLM-backed initial plan generation using the same gate
- [x] `pivot_agent` and `generic_llm` planners in `evals/src/planners.ts` (implemented in `evals/src/llmPlanners.ts`)
- [x] Fill in `evals/pricing.json` from current provider pricing (gpt-5.4-mini only; add others before comparing models)
- [x] First dev-split runs for both planners; log failures by category: [results and failure log](evals/results/2026-11-02-dev/README.md)
- [x] Remove the "Preview" labels only where output is actually AI-generated

## Week 3: Reliability and users

- [ ] Fix the four `pivot_agent` failure types from the first dev run (format errors, restrictions stated only in the message, not acknowledging infeasible requests, options that don't resolve the disruption). See the [results](evals/results/2026-11-02-dev/README.md).

- [ ] Iterate prompts and tools on the dev split only
- [ ] Rubric for subjective acceptance; two blind raters
- [ ] User-study protocol, consent, and task cards; pilot with 1 or 2 people
- [ ] First user tests (manual vs Pivot timing)
- [ ] Google Calendar FreeBusy provider (read-only), if the core is stable
- [ ] Decide whether a server-side store is needed

## Week 4: Evaluation and demo

- [ ] Fresh held-out scenarios from a teammate who hasn't seen the prompts
- [ ] Held-out comparative runs: noop, rule_based, generic_llm, pivot_agent
- [ ] Complete user tests; compute Metric 2 from real data only
- [ ] Fix major failures and re-run (record every held-out run)
- [ ] Polish UI, add an empty-week state for late Sunday, final copy review
- [ ] Deploy to Vercel; demo script and backup recording

## Out of scope unless approved

- Studio discovery and Google Places
- ClassPass or any booking integration
- Calendar event creation (needs an explicit confirmation design first)
- Authentication and multi-user support
