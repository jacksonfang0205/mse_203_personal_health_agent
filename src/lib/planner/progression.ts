/**
 * Weekly load budget: how many minutes this week should hold, given what the
 * user actually did recently, their goal and their condition.
 *
 * Load is weekly minutes (the app has no per-exercise intensity yet). Rules:
 *
 * - Continuing users (trained in the last 14 days): build from what they did,
 *   not from what they said in setup. Endurance, fat-loss and general goals
 *   progress by duration, about 10% a week (ACSM 2009 position stand on
 *   progression models; the common "10% rule"). Strength progresses by load and
 *   sets, so minutes rise only ~5%. The acute:chronic workload ratio stays
 *   ≤ 1.3 against the 4-week average, the range linked to the lowest injury
 *   risk (Gabbett 2016, Br J Sports Med).
 * - Returning after 2+ weeks off: restart at 50–70% of the pre-break load,
 *   less the longer the break, since fitness falls off with detraining (Mujika &
 *   Padilla 2000, Sports Med).
 * - New users: start below their stated target and build over a few weeks
 *   ("start low, go slow", ACSM Guidelines for Exercise Testing and
 *   Prescription). Less experienced users start lower.
 * - A stated injury, pain or low energy: hold (no increase) or reduce.
 *
 * The planner uses `planMinutes`; the validation gate uses `capMinutes`, so a
 * "do more" request can add at most one step of progression.
 */
import type { FitnessProfile, IsoDate, WorkoutLogEntry } from "../schemas";
import { addDays } from "../time";

export type LoadStatus = "new" | "returning" | "continuing";

export interface LoadBudget {
  status: LoadStatus;
  /** Minutes the planner aims for this week (never above the user's stated target). */
  planMinutes: number;
  /** Hard cap the validation gate enforces for the week. */
  capMinutes: number;
  /** Longest single session this week. */
  sessionMinutes: number;
  /** How many sessions fit the budget (at most the user's frequency). */
  sessions: number;
  /** Recent weekly minutes the budget was built from, if any. */
  baseline?: number;
  /** One plain sentence for the plan notes. */
  reason: string;
}

const NEW_USER_START = { beginner: 0.5, intermediate: 0.6, advanced: 0.7 } as const;
const MIN_SESSION = 10;
const CAUTION =
  /\b(injur\w*|pain\w*|hurt\w*|sore|strain\w*|sprain\w*|tweak\w*|weird|tendon\w*|surgery|recover\w*|exhausted|burn(ed|t)? out|low energy|sick|ill)\b/i;

/** True when setup text or the latest message says something hurts or energy is low. */
export function needsCaution(profile: Pick<FitnessProfile, "limitations" | "avoidNotes">, message = ""): boolean {
  return CAUTION.test([profile.limitations ?? "", profile.avoidNotes ?? "", message].join(" "));
}

/** Weekly increase allowed for this goal, before the caution rule. */
function goalStep(goals: FitnessProfile["goals"]): number {
  const primary = goals[0];
  if (primary === "strength") return 1.05; // progress with load and sets, not time
  return 1.1;
}

const sum = (xs: WorkoutLogEntry[]) => xs.reduce((s, x) => s + x.durationMin, 0);
const round5 = (n: number) => Math.round(n / 5) * 5;

export function weeklyLoadBudget(args: {
  profile: FitnessProfile;
  log: WorkoutLogEntry[];
  weekStart: IsoDate;
  message?: string;
}): LoadBudget {
  const { profile, weekStart } = args;
  const target = profile.frequencyPerWeek * profile.sessionMinutes;
  const done = args.log.filter((e) => e.status === "completed" && e.date < weekStart);
  const inRange = (from: number, to: number) => done.filter((e) => e.date >= addDays(weekStart, from) && e.date <= addDays(weekStart, to));
  const caution = needsCaution(profile, args.message);

  const lastWeek = sum(inRange(-7, -1));
  const prevWeek = sum(inRange(-14, -8));
  const chronic = sum(inRange(-28, -1)) / 4;
  const last = done.map((e) => e.date).sort().at(-1);

  let status: LoadStatus;
  let plan: number;
  let cap: number;
  let baseline: number | undefined;
  let reason: string;

  if (lastWeek > 0 || prevWeek > 0) {
    status = "continuing";
    baseline = lastWeek || prevWeek;
    const step = caution ? 1 : goalStep(profile.goals);
    // The ratio needs a real 4-week history; with less, missing weeks would read as zero training.
    const acwrCap = inRange(-28, -15).length > 0 ? chronic * 1.3 : Infinity;
    cap = Math.min(baseline * step, acwrCap);
    if (caution) cap = Math.min(cap, baseline);
    plan = Math.min(target, cap);
    reason = caution
      ? `Holding at about last week's ${baseline} minutes while something's bothering you.`
      : plan < target
        ? `Building from last week's ${baseline} minutes, about ${Math.round((step - 1) * 100)}% more per week.`
        : `At your ${target}-minute weekly target.`;
  } else if (last) {
    status = "returning";
    const weeksOff = Math.floor((Date.parse(weekStart) - Date.parse(last)) / (7 * 864e5));
    const before = sum(done.filter((e) => e.date > addDays(last, -28))) / 4 || target;
    const f = weeksOff >= 8 ? 0.5 : weeksOff >= 4 ? 0.6 : 0.7;
    baseline = Math.round(before);
    plan = Math.min(target, before * f * (caution ? 0.85 : 1));
    cap = plan;
    reason = `Easing back in after ${weeksOff} weeks off: about ${Math.round(f * 100)}% of your usual load, building up from here.`;
  } else {
    status = "new";
    const f = NEW_USER_START[profile.experience] * (caution ? 0.85 : 1);
    plan = target * f;
    cap = plan;
    reason = `Starting at about ${Math.round(f * 100)}% of your ${target}-minute goal and building up over the next few weeks.`;
  }

  const planMinutes = Math.max(MIN_SESSION, round5(plan));
  const capMinutes = Math.max(planMinutes, round5(cap));
  const sessions = Math.max(1, Math.min(profile.frequencyPerWeek, Math.floor(planMinutes / MIN_SESSION)));
  const sessionMinutes = Math.max(MIN_SESSION, Math.min(profile.sessionMinutes, Math.floor(planMinutes / sessions / 5) * 5));
  return { status, planMinutes, capMinutes, sessionMinutes, sessions, baseline, reason };
}
