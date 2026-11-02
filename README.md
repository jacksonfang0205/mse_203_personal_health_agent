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

- **Daily checklist, not time slots**: workouts are assigned to days, not times. Open Pivot, see today's workout, and tick off each exercise (or the whole thing) whenever suits you. The calendar only decides which days get a workout and how long it can be: a packed day gets a shorter session or rest (`src/lib/capacity.ts`).
- **Today screen**: today's workout with a progress ring, checkable exercise steps with photos (start and end positions crossfade to show the movement), a front/back body map of target muscles, a streak, and a rest-day view.
- **AI planning** (`/api/plan`): the model picks days, lengths, formats and catalog exercises from each day's free time and your memory. Server code rebuilds every workout from the catalog and keeps only what passes the validation gate. Falls back to the template planner if AI is off or fails.
- **AI Life Happens** (`/api/life-happens`): reads your message and proposes up to three alternatives (shorter, another day, different format, rest). Other workouts the change knocks out are moved or skipped automatically and listed as tradeoffs.
- **Memory**: times or whole days you can't work out (they reduce a day's free time), notes, and a workout log. Life Happens suggests things to remember and you approve each one. Edit everything in Preferences → Memory.
- **Learning from past weeks** (`src/lib/insights.ts`): completion by day and format, when you usually check workouts off, and which kinds of options you pick. This goes to the agent.
- **Exercise photos**: 46 of 63 catalog exercises use public-domain photos from [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (`public/exercises/`). The rest show an illustrated card rather than a photo of a different movement. Every exercise links to a YouTube form-demo search.

The calendar is still simulated. User data is stored only in your browser's localStorage. Reset it from Preferences → Study tools.
