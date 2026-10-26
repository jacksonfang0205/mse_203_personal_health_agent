# Pivot: Implementation Plan

Pivot is an AI workout planner for busy students and young professionals. Its core feature is "Life Happens": the user describes what changed in plain language, and Pivot proposes up to three feasible, goal-aware alternatives that they approve before anything is saved.

This document covers the architecture, data models, agent tools, phases, and risks. The evaluation design is in [EVAL_PLAN.md](EVAL_PLAN.md), and the task checklist is in [TASKS.md](TASKS.md).

## 1. Starting point

The repo began as a fresh `create-next-app` project:

- Next.js 16.4 (App Router, Turbopack) with `cacheComponents` and `partialPrefetching` enabled in `next.config.ts`
- React 19.3, TypeScript 5, Tailwind CSS v4 via the `@tailwindcss/turbopack` loader (no PostCSS config)
- ESLint 9 with `eslint-config-next`, including the React Compiler lint rules (`react-hooks/purity` and others)
- Source under `src/`, path alias `@/*`

Phase 1 adds three dependencies: `zod` (runtime), plus `vitest` and `tsx` (dev only). `@types/node` was bumped to v24 to satisfy Vitest's peer range.

## 2. Architecture

The guiding rule: the LLM reasons and proposes; deterministic code validates, decides what is allowed, and persists.

```
Browser (client components)
  ├─ Onboarding / Preferences ── writes FitnessProfile
  ├─ Week dashboard ──────────── reads plan, marks status
  ├─ Life Happens panel ──────── sends message + state snapshot
  │                                     │
  │                         Phase 2: POST /api/life-happens
  │                                     │
  │                        ┌────────────▼─────────────┐
  │                        │ Agent loop (server only) │
  │                        │  LLM + tool calls        │
  │                        └────────────┬─────────────┘
  │                                     │ propose_schedule_changes
  │                        ┌────────────▼─────────────┐
  │                        │ Validation gate          │  src/lib/validation.ts
  │                        │ (deterministic)          │  same code the evals use
  │                        └────────────┬─────────────┘
  │                                     │ only valid alternatives
  ├─ Alternatives UI ◄──────────────────┘
  └─ User clicks "Use this" → re-validate → persist (store.ts)
```

Layers in `src/lib`:

| Layer | File | Responsibility |
| --- | --- | --- |
| Schemas | `schemas.ts` | Zod schemas for every stored, exchanged, or LLM-produced object |
| Catalog | `catalog.ts` | 60+ curated exercises with category, muscles, equipment, level, avoid tags, prescription, time cost |
| Calendar adapter | `calendar.ts` | `CalendarProvider` interface, `SimulatedCalendarProvider`, three synthetic presets |
| Validation | `validation.ts` | Hard-constraint checks and soft-preference warnings |
| Planning | `planner/generate.ts`, `planner/alternatives.ts` | Deterministic template planner, slot finding, rule-based alternatives, `applyOperations` |
| Persistence | `store.ts` | `PivotRepository` interface, localStorage implementation, React hook via `useSyncExternalStore` |
| Telemetry | `telemetry.ts` | Local timing events for user studies |

### Key decisions

1. **Client-side persistence for the prototype.** State lives in localStorage behind a `PivotRepository` interface and is re-validated with Zod on every load. In Phase 2 the client sends a state snapshot with each agent request, so the server stays stateless and no database or auth is needed. When we need multi-device use or Google OAuth tokens (which must stay server-side), we swap in a server repository (Vercel-compatible KV or Postgres) without touching components.
2. **Wall-clock dates and times.** Plans store `YYYY-MM-DD` plus `HH:MM` with no time zone, and all date math runs in UTC. The Google adapter will convert RFC 3339 FreeBusy results into the user's local wall clock at the boundary.
3. **Client-only rendering for personal data.** Pages are statically prerendered shells. Anything that depends on stored state or the current time renders after hydration (`usePivotState` and `useNow` return `null` on the server), which avoids hydration mismatches and Cache Components' restrictions on reading the clock during prerender.
4. **The agent cannot save.** `save_approved_plan` is not an LLM tool. Saving happens only when the user clicks approve, and the plan is validated again at that moment.
5. **Catalog grounding.** The LLM picks from the catalog by id. Unknown ids fail `catalog_grounded`. A deterministic `buildWorkout` helper can assemble sessions from LLM-chosen parameters so the model never invents sets or durations from scratch.
6. **Every non-AI output is labeled.** Workouts carry an `origin` (`mock_template`, `rule_based`, `agent`, `user`) and the UI shows "Sample data" or "Rule-based preview" badges, so mock output is never mistaken for AI output in demos or user tests.

## 3. Data models

All defined in `src/lib/schemas.ts`.

- **FitnessProfile**: goals, target muscles, experience level, enjoyed workout types, equipment, session minutes (also the hard per-session cap), frequency per week, preferred days and times, avoid tags (`high_impact`, `running`, `overhead`, `floor_work`, `heavy_barbell`), avoided exercise ids, free-text avoid notes, optional free-text limitations. There is no weight or BMI field.
- **Exercise**: catalog entry. `equipment` lists everything required, and `tags` drive avoidance checks.
- **Workout**: id, title, date, start, duration, category (`strength`, `cardio`, `hiit`, `pilates`, `yoga`, `mobility`), muscles, equipment, exercises with sets/reps/seconds/minutes, rationale, status (`planned`, `completed`, `skipped`), origin.
- **WeeklyPlan**: week start (Monday), workouts, `generatedBy`, and `notes` for goals or constraints the plan could not satisfy.
- **BusyBlock**: date, start, end, title, source (`simulated`, `google`, `user_message`).
- **PlanOperation**: `move`, `replace`, `skip`, or `add`. Alternatives are lists of operations, so diffs are explicit and easy to validate.
- **Alternative**: kind (`shorter`, `move`, `swap_format`, `skip`), title, summary, tradeoffs, operations.
- **Proposal**: the user message, what the planner understood, up to three alternatives, an optional `infeasibleReason`, and `generatedBy`.
- **ChangeRecord**: accepted or rejected decision, chosen alternative, and the kinds that were offered. This is the memory of past changes and preferences between alternatives.

## 4. Agent tools (Phase 2)

| Tool | Kind | Returns |
| --- | --- | --- |
| `get_fitness_profile` | read | FitnessProfile |
| `get_current_plan` | read | WeeklyPlan with statuses |
| `get_workout_history` | read | Recent ChangeRecords and accepted/rejected alternative kinds |
| `get_calendar_availability(start, end)` | read | Busy blocks plus the `knownRange` the provider can vouch for |
| `search_exercises(category, muscles?, equipment?)` | read | Catalog entries filtered by the user's equipment and avoidances |
| `build_workout(category, focus, minutes, date, start)` | deterministic | A catalog-grounded Workout, or an error if impossible |
| `validate_workout_plan(operations)` | deterministic | Violations for a candidate change, so the model can repair it |
| `propose_schedule_changes(understood, alternatives, infeasibleReason?)` | terminal | Ends the loop. The server validates every alternative and drops or repairs failures. |
| `save_approved_plan` | **user action, not an LLM tool** | Called from the approve button after a final validation |

Loop limits: at most about 8 tool calls and 2 repair rounds per request. If nothing survives validation, the response says so honestly instead of inventing time.

Prompt rules the agent must follow, checked in evals: never claim a different workout gives identical benefits, never add make-up volume, never modify completed workouts, never give medical or rehab advice, and say plainly when goals conflict or no window exists.

## 5. Calendar integration

`CalendarProvider` has two methods: `getBusy(range)` and `knownRange()`. Dates outside `knownRange` count as unknown, not free, and the `grounded_availability` check enforces that.

- **Now:** `SimulatedCalendarProvider` with three synthetic presets (student, young professional, light week), selectable on the Preferences page.
- **Later (Week 3, if feasible):** `GoogleCalendarProvider` using OAuth 2.0 and the FreeBusy API, read-only scope. Creating or changing events requires an explicit confirmation step per event, and Pivot never deletes or overwrites existing events.

## 6. Studio discovery (stretch, not built)

If time allows after Week 4 polish, this would be a `StudioProvider` adapter (Google Places Text Search for nearby studios by activity type) feeding an optional `find_studios` tool. It would show only data the API returns: names, addresses, and links. It would never invent class schedules, availability, or booking. Location would be asked for only when the user opens that feature. ClassPass and other booking integrations are out of scope.

## 7. Phases

| Phase | Week | Scope | Status |
| --- | --- | --- | --- |
| 1 | 1 | Schemas, design system, onboarding, editable preferences, dashboard, simulated calendar, validation, local persistence, eval harness and fixtures | **Done (this session)** |
| 2 | 2 | `/api/life-happens` route, agent loop with tools, LLM workout generation, generic-LLM baseline planner, eval adapters for both | Next |
| 3 | 3 | Reliability work driven by dev-split evals, rubric-based acceptance scoring, first user tests, Google FreeBusy if feasible | |
| 4 | 4 | Held-out comparative evaluation, fixes for major failures, polish, demo | |

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| LLM proposes invalid schedules | Deterministic gate on every alternative, repair loop, honest "nothing fits" fallback |
| LLM ignores free-text limitations | Machine-checkable avoid tags for common cases; free text is context only, and evals include restriction scenarios |
| localStorage is per browser | Fine for single-user demos and moderated user tests; repository interface allows a server store later |
| Google OAuth delays | Simulated provider unblocks everything; Google is Week 3 at the earliest |
| Next.js 16 conventions differ from older docs | Bundled docs in `node_modules/next/dist/docs/` checked before changes; keep server code to one route handler |
| Eval data leakage | Separate held-out file, runner refuses held-out without `--heldout-ok`, test asserts disjoint splits |
| `mustChange` is a weak oracle (any change counts) | Pair objective checks with rubric review of intent in Phase 3 |
| API cost overruns | Small catalog, compact tool results, token and cost logging per eval run |
| Time zones once Google is added | Convert at the adapter boundary; keep the core on wall-clock time |

## 9. Paid APIs, OAuth, and manual setup

| Item | Needed for | Cost | Who sets it up |
| --- | --- | --- | --- |
| Anthropic (or OpenAI) API key in `ANTHROPIC_API_KEY` | Phase 2 agent and evals | Paid per token | Team, server-side env var only |
| Vercel project | Deployment | Free Hobby tier is likely enough | Team |
| Google Cloud project, OAuth consent screen, OAuth client, test users | Week 3 Google Calendar | Free; app stays in "testing" mode, so testers must be added by email | Team |
| Server store (Vercel KV/Postgres or similar) | Only if we need multi-device or OAuth tokens | Free tiers exist | Team |
| Google Places API | Stretch studio discovery only | Requires a billing account | Not planned |
| User study consent | Planning-time baseline | Check course guidance on consent forms | Team |

Phase 1 needs none of these. It runs locally with no credentials.
