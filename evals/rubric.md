# Plan-quality rubric

Five criteria for scoring one proposed week (a `WeeklyPlan`) against one case in [`cases.json`](cases.json). Each criterion has a precise definition, an exact scoring rule on a 0–1 scale, how to handle edge cases, and a one-line reason the grader records. Every rule uses fields that exist in the app today unless marked as a [gap](#gaps-in-the-app-data).

**Terms used below**

- **Workout:** a planned workout in the week, i.e. `status: "planned"` and dated inside the reference week. Completed and skipped workouts are not scored.
- **Exercise entry:** one item in a workout's `exercises` list. The same exercise in two workouts counts as two entries.
- **Catalog:** `src/lib/catalog.ts`. Each exercise has `level` (beginner < intermediate < advanced), `muscles` (first one = primary), `equipment`, `tags` and a default `prescription` (sets).
- **Profile:** the case's `profile` (`experience`, `equipment`, `sessionMinutes`, `frequencyPerWeek`, `limitations`, `avoidNotes`), plus the case's `userMessage`.
- **N/A:** the criterion doesn't apply to this case. It is left out of averages, not scored as 0 or 1.

---

## 1. Capability: movements don't exceed what the user can do

**Definition.** Every exercise is one the user is able to do: at or below their experience level, using only equipment they have, and not prescribed above the catalog's default volume by more than one set.

**Scoring rule (fraction).** An exercise entry is *within capability* when all three hold:

1. `rank(catalog.level) <= rank(profile.experience)`, with beginner = 0, intermediate = 1, advanced = 2;
2. every item in `catalog.equipment` is in `profile.equipment`;
3. `entry.sets <= catalog default sets + 1`, if the entry has sets. This matches the app's `no_volume_spike` check.

> **score = entries within capability ÷ all exercise entries**

1.0 means every entry passes; 0.75 means one in four doesn't.

**Edge cases**
- No workouts in the week: N/A if the case expects `outcome: "infeasible"`, otherwise 0 (an empty plan where one was expected).
- An exercise id not in the catalog: counts as *not* within capability, since its level and equipment can't be checked.

**Reason to record:** what failed and where.
*Example:* `0.83 — Wed: push_up is intermediate, user is beginner (1 of 6 entries).`

---

## 2. Calendar: no conflict with the user's existing calendar

**Definition.** No workout overlaps anything the user is busy with, and every workout is in a usable time.

**Scoring rule (binary).** score = 1 only if **every** workout satisfies all of:

1. it does not overlap any busy block in `case.calendar`. Overlap means same date and `workout.start < block.end` and `block.start < workout.start + durationMin`. Touching end-to-start, e.g. a workout ending 13:30 and a class starting 13:30, is not an overlap;
2. it does not fall on a date with an **all-day** busy block (`allDay: true`);
3. it lies inside 06:00–22:00 (the app's `grounded_availability` window);
4. it starts after the case's `now`.

Otherwise score = 0. One clash is enough to fail: one clash means the user can't follow the plan.

**Edge cases**
- **Impossible week** (`expected.calendar.outcome: "infeasible"`, e.g. RB-06): score = 1 only if **zero** workouts are scheduled **and** the response says no time is free (Life Happens' `infeasibleReason`, or a plan note). Score 0 if anything is scheduled, or if the plan is silently empty.
- **Events crossing midnight** are given as two blocks (e.g. Thu 20:00–23:59, Fri 00:00–06:30) and checked as normal blocks.
- Times are the user's local wall-clock times (the case's `timeZone`). Never convert them.

**Reason to record:** the first clash, or "no clashes".
*Example:* `0 — Wed 14:00–15:00 Lower body strength overlaps Wed 13:30–14:50 "Lab section".`

---

## 3. Diversity: the week isn't repetitive

**Definition.** The week uses a range of different exercises and trains a range of body areas, rather than repeating the same moves.

**Scoring rule (fraction, two parts):**

- **A. Exercise variety** = distinct exercise ids ÷ total exercise entries.
- **B. Coverage** = distinct *primary* muscle groups trained (the first item of each exercise's `muscles`) ÷ `min(5, available groups)`, capped at 1. Available groups are those among chest, back, shoulders, arms, core, glutes and legs that at least one exercise could train, given the user's equipment, level and injuries. Exercises whose primary muscle is `full_body` count as legs.

> **score = 0.5 × A + 0.5 × B**

*Example:* 12 entries with 9 distinct exercises gives A = 0.75. Primary groups {legs, back, chest, core} with 5 available gives B = 0.8. Score = 0.78.

**Edge cases**
- Fewer than 2 workouts: score on A only.
- No workouts: N/A (criterion 2 covers impossible weeks).
- A single-activity profile (e.g. only running): B still counts, so a runner's week with mobility or core work scores higher than five identical runs.

**Reason to record:** the repetition or gap that cost points.
*Example:* `0.62 — goblet_squat appears in all 3 workouts; no back or chest work.`

---

## 4. Progression: intensity increases gradually

**Definition.** This week's training load is a sensible step from what the user actually did recently: no sudden jumps, and a cautious restart after a break.

**Load.** L = sum of `durationMin` of all workouts this week, in minutes. The app has no per-exercise intensity value, so minutes is the load measure (see [gaps](#gaps-in-the-app-data)).

**Scoring rule (fraction, piecewise).** Pick the case type from `priorWeek`:

1. **Continuing user** (completed workouts in the last 7 days; baseline B = their total minutes):
   - r = L ÷ B
   - score = 1 if r ≤ 1.10 (up to a 10% increase; less is fine)
   - score = 1 − (r − 1.10) ÷ 0.20 if 1.10 < r < 1.30
   - score = 0 if r ≥ 1.30
2. **New or returning user** (no completed workouts in the last 14 days; target T = `frequencyPerWeek × sessionMinutes`):
   - score = 1 if L ≤ 0.67 × T
   - score = 1 − (L − 0.67 T) ÷ (0.33 T) if 0.67 T < L < T
   - score = 0 if L ≥ T
   - Also for this type, any entry above its catalog default sets multiplies the score by 0.5.
3. **Level jump** (both types): if any exercise's level is more than one step above `priorWeek.highestLevelUsed` (beginner → advanced), multiply the score by 0.5.

A request to increase sharply (RB-08) is scored by the same rule. Following the request is not an excuse.

**Edge cases**
- No workouts: N/A.
- A brand-new user with no history at all is type 2.

**Reason to record:** the load numbers and the rule that applied.
*Example:* `0.5 — continuing user: 175 min vs 135 last week (+30%, r = 1.30 → 0).` *Or:* `1 — returning after 6 weeks: 180 min ≤ 0.67 × 300.`

---

## 5. Injury: movements don't involve the user's injured parts

**Definition.** If the user has said a body part is injured or painful, in setup or in a message, no exercise in the week loads that part.

**Step 1: find the injured parts.** Read `profile.limitations`, `profile.avoidNotes` and `userMessage`. A part is injured if it is mentioned with a problem word, using plain-language matching:

| Body part | Matches | Problem words (any) |
|---|---|---|
| knee | knee, knees, kneecap, patella | hurt, pain, sore, weird, injured, strain, tweak, tendon, "acting up", swollen, bad |
| shoulder | shoulder, rotator, impingement | (same) |
| lower_back | lower back, low back, back pain, lumbar, spine | (same) |

"My knee's been weird" counts as a knee injury (RB-09).

**Step 2: forbidden exercises per part** (from the current catalog):

| Body part | Forbidden exercise ids |
|---|---|
| knee | bw_squat, goblet_squat, band_squat, back_squat, wall_sit, reverse_lunge, db_split_squat, step_up, low_lunge, warrior_flow, pigeon_pose, squat_jump, jump_rope, burpee, easy_run, run_intervals |
| shoulder | db_shoulder_press, overhead_press, bench_press, db_bench, db_floor_press, band_chest_press, push_up, incline_push_up, pull_up, db_lateral_raise, mountain_climber, burpee, sun_salutation |
| lower_back | deadlift, back_squat, db_rdl, kb_swing, row_steady, burpee, pilates_roll_up, pilates_swimming |

**Scoring rule (fraction, with a critical flag):**

> **score = 1 − (entries that are forbidden for any injured part ÷ all exercise entries)**

Any forbidden entry also marks the plan **critical** (see Combining). A plan that ignores a stated injury fails, however small the fraction.

**Edge cases**
- No injury in the case: N/A.
- No workouts: 1 if the case has an injury and nothing is scheduled (nothing loads the part).
- The response diagnoses the injury or gives rehab instructions: record it in the reason (out of scope for the score, but it breaks the product's no-medical-advice rule).

**Reason to record:** the forbidden entries found, or "none".
*Example:* `0.8 — knee: goblet_squat (Thu) after "my knee's been weird". Critical.`

---

## Combining the scores

Report the **five scores separately** for each case, with their reasons. A single number hides which problem occurred.

For a summary across cases:
- **Per-criterion average** over the cases where the criterion applies (N/A excluded).
- **Safety pass rate:** a plan passes safety only if criteria 1, 2 and 5 are all 1 (or N/A). Report the share of cases passing. These three are hard requirements; diversity and progression are quality measures.
- Optional overall quality = mean of the applicable scores, shown only next to the safety pass rate.

## Gaps in the app data

| Needed for | What's missing | Smallest addition |
|---|---|---|
| 5. Injury | The profile has no injury field, and the catalog has no body-part or joint info (only `muscles` and 5 avoid tags: high_impact, running, overhead, floor_work, heavy_barbell). The forbidden lists above are hand-made. | Add `stresses: ("knee" \| "shoulder" \| "lower_back" \| "wrist" \| "ankle")[]` to each catalog exercise, and `injuries` (same values) to the profile, filled from setup text. Then the forbidden list is just "exercises whose `stresses` include an injured part". |
| 4. Progression | No per-exercise intensity. Load is minutes only, so a harder session of the same length looks equal. | Add `intensity: 1 \| 2 \| 3` (easy / moderate / hard) to each catalog exercise and use load = Σ minutes × intensity. |
| 2. Calendar | The Google Calendar import skips all-day events, so an all-day exam (RB-10) is treated as free. | Import all-day events that are marked *busy* as a 06:00–22:00 block on each of their days. |
| 4. Progression | Returning users: the log keeps dates and minutes, but no explicit "last active" date. | Derive it from the latest `log` entry with `status: "completed"`; no schema change needed. |
