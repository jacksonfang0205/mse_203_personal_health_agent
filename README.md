# Pivot

Fitness that fits your life. An AI workout planner that adapts when your week changes. Built for Stanford MS&E 203.

- Architecture and roadmap: [PLAN.md](PLAN.md)
- Evaluation methodology: [EVAL_PLAN.md](EVAL_PLAN.md)
- Task checklist: [TASKS.md](TASKS.md)
- Eval harness: [evals/README.md](evals/README.md)

## Run locally

Requires Node 20.19+ (developed on Node 26).

```bash
npm install
cp .env.example .env.local   # add LLM_API_KEY for live AI (optional)
npm run dev                  # http://localhost:3000
```

Without a key, everything works with the rule-based planner and the UI says so.

## Checks

```bash
npm run lint
npm run typecheck
npm test           # Vitest: validation, planner, and eval fixture integrity
npm run eval -- --planner rule_based   # eval harness on the dev split
npm run build
```

## Status

- **AI planning** (`/api/plan`): the model picks days, times, formats and catalog exercises from your free windows and memory. Server code rebuilds every workout from the catalog and keeps only what passes the validation gate. Falls back to the template planner if AI is off or fails.
- **AI Life Happens** (`/api/life-happens`): reads your message and proposes up to three alternatives. Other workouts the change knocks out are moved or skipped automatically and listed as tradeoffs. One repair round runs if nothing passes, then rule-based options, then an honest "nothing fits".
- **Memory**: times you can't work out (treated as busy, like calendar events), notes, and a workout log. Life Happens suggests things to remember and you approve each one. Edit everything in Preferences → Memory.
- **Learning from past weeks** (`src/lib/insights.ts`): completion by time of day, day and format, plus which kinds of options you pick. This goes to the agent, and the template planner tries your best-performing windows first.
- **Form demos**: each exercise links to a YouTube search, never a generated URL.

The calendar is still simulated. User data is stored only in your browser's localStorage. Reset it from Preferences → Study tools.
