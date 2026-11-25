/**
 * "Ask before big changes", collaboratively. A vague or preference-level
 * request ("maintain function and mobility in my lower body, but don't focus
 * on strength", "move from upper body to lower body") gets two or three short
 * questions with quick replies, one at a time; each answer shapes the next
 * question. Nothing changes until the user has answered (or skipped), and the
 * resulting change is built here, in code, touching only the days and
 * exercises it has to. Small, specific requests (a day, a time, a length,
 * skip/move) skip all of this and go straight to the coach.
 */
import { getExercise } from "../catalog";
import { addMobilityBlock, rebuildForRegion, REGION_LABEL, swapRegionForMobility, trainsRegion, type Region, type TrimFrom } from "../planner/focus";
import type { BodyFocus, FitnessProfile, IsoDate, PlanOperation, WeeklyPlan, Workout } from "../schemas";
import { formatDate } from "../time";
import { isLowerBody } from "../validation";

// ---------- understanding the request ----------

export interface PreferenceRequest {
  /** "emphasis": change what a region gets; "shift": move focus from one region to another. */
  kind: "emphasis" | "shift";
  /** The region the user wants changed (for a shift, the one gaining focus). */
  region: Region;
  from?: Region;
  emphasis: "mobility" | "strength";
  /** "but do not want to focus strength or growth" */
  notStrength: boolean;
  /** "lower-body mobility", for questions and memory. */
  phrase: string;
}

const LOWER = /\b(lower[- ]?body|legs?|hips?|glutes?|knees?|hamstrings?|quads?)\b/i;
const UPPER = /\b(upper[- ]?body|arms?|chest|shoulders?|biceps|triceps|upper back)\b/i;
const regionIn = (t: string): Region | null => (LOWER.test(t) && !UPPER.test(t) ? "lower" : UPPER.test(t) && !LOWER.test(t) ? "upper" : null);
const regionWord = (t: string): Region | null => (/^(lower|legs?|hips?|glutes?)/i.test(t) ? "lower" : /^(upper|arms?|chest|shoulders?)/i.test(t) ? "upper" : null);

const MOBILITY = /\b(mobility|mobile|function(al)?|flexib\w*|stretch\w*|range of motion|move better|joints?|stiff\w*)\b/i;
const STRENGTH = /\b(strength|strong\w*|muscle|growth|grow|hypertrophy|build\w*|bulk\w*|size|gains?)\b/i;
const NEGATED_STRENGTH =
  /\b(not|no|don'?t|do not|without|rather than|instead of|less|never|avoid)\b[^.;]{0,40}\b(strength|strong\w*|muscle|growth|grow|hypertrophy|build\w*|bulk\w*|size|gains?)\b/i;
const INTENT =
  /\b(maintain|keep up|keep (?:my|some)|focus|work on|more|less|improve|add some|incorporate|include|prioriti[sz]e|emphasi[sz]e|get better|want|prefer|need|should|balance|shift|switch|move|change)\b/i;
/** Pins a request to a day, time, length or one-off action: those go straight through. */
const SPECIFIC =
  /\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?\b|\b(today|tonight|tomorrow|this (?:morning|afternoon|evening)|next (?:session|workout))\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b|\b\d+\s*-?\s*min|\b(skip|cancel|reschedule|shorter|longer|busy|meeting|exam|midterm|can'?t|cannot|only have|sick|travel\w*|out of town|no time)\b/i;
const SHIFT =
  /\bfrom\s+(?:my\s+)?(upper|lower|legs?|arms?|chest|shoulders?)\b[\w\s-]{0,20}?\bto\s+(?:more\s+)?(upper|lower|legs?|arms?|chest|shoulders?)\b|\bless\s+(upper|lower)[- ]?body\b.{0,30}\bmore\s+(upper|lower)[- ]?body\b|\bmore\s+(upper|lower)[- ]?body\b.{0,30}\bless\s+(upper|lower)[- ]?body\b/i;

/** Reads a preference-level request, or null for anything specific or unrelated. */
export function parsePreferenceRequest(message: string): PreferenceRequest | null {
  const text = message.replace(/’/g, "'");
  const shift = text.match(SHIFT);
  if (shift && !/\b(mon|tue|wed|thu|fri|sat|sun)\w*\b|\btoday|tomorrow\b/i.test(text)) {
    const [from, to] = shift[1]
      ? [regionWord(shift[1]), regionWord(shift[2])]
      : shift[3]
        ? [regionWord(shift[3]), regionWord(shift[4])]
        : [regionWord(shift[6]), regionWord(shift[5])];
    if (from && to && from !== to) {
      const mobility = MOBILITY.test(text) && !STRENGTH.test(text.replace(NEGATED_STRENGTH, ""));
      return { kind: "shift", region: to, from, emphasis: mobility ? "mobility" : "strength", notStrength: NEGATED_STRENGTH.test(text), phrase: `${REGION_LABEL[to]} focus` };
    }
  }
  if (!INTENT.test(text) || SPECIFIC.test(text)) return null;
  const region = regionIn(text);
  if (!region) return null;
  const notStrength = NEGATED_STRENGTH.test(text);
  const wantsStrength = STRENGTH.test(text.replace(NEGATED_STRENGTH, ""));
  const emphasis = MOBILITY.test(text) || notStrength ? "mobility" : wantsStrength ? "strength" : null;
  if (!emphasis) return null;
  return { kind: "emphasis", region, emphasis, notStrength, phrase: `${REGION_LABEL[region]} ${emphasis}` };
}

// ---------- questions ----------

export interface ClarifyChoice {
  label: string;
  value: string;
}

export interface ClarifyQuestion {
  id: "how" | "days" | "trim" | "style";
  text: string;
  choices: ClarifyChoice[];
  /** What "Skip" picks. */
  fallback: string;
}

export type ClarifyAnswers = Partial<Record<ClarifyQuestion["id"], string>>;

export interface Clarification {
  request: PreferenceRequest;
  /** The next question, or null when there's enough to propose a change. */
  next: ClarifyQuestion | null;
}

const upcoming = (plan: WeeklyPlan, today: IsoDate) =>
  plan.workouts
    .filter((w) => w.status === "planned" && w.date >= today)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

const dayChoice = (w: Workout): ClarifyChoice => ({ label: `${formatDate(w.date)} · ${w.title}`, value: w.id });

/** Workouts a change for this request may touch, given the "how" answer. */
function candidates(req: PreferenceRequest, how: string | undefined, plan: WeeklyPlan, today: IsoDate): Workout[] {
  const all = upcoming(plan, today).filter((w) => w.category !== "cardio");
  if (req.kind === "shift") return all.filter((w) => req.from && trainsRegion(w, req.from) && !trainsRegion(w, req.region));
  if (how === "swap") return all.filter((w) => trainsRegion(w, req.region));
  // A block or a whole day: days that already train the region come first; otherwise any day.
  const inRegion = all.filter((w) => trainsRegion(w, req.region));
  return inRegion.length ? inRegion : all;
}

/** The next question to ask, given the answers so far. Two or three questions at most. */
export function nextQuestion(req: PreferenceRequest, answers: ClarifyAnswers, plan: WeeklyPlan, today: IsoDate): ClarifyQuestion | null {
  const region = REGION_LABEL[req.region];
  if (req.kind === "shift") {
    const from = REGION_LABEL[req.from!];
    if (!answers.days) {
      const days = candidates(req, undefined, plan, today);
      if (!days.length) return null;
      return {
        id: "days",
        text: `Which ${from} day${days.length > 1 ? "s" : ""} should shift to ${region}?`,
        choices: [...days.map(dayChoice), ...(days.length > 1 ? [{ label: "All of them", value: "all" }] : []), { label: "Just remember it", value: "remember" }],
        fallback: days[0].id,
      };
    }
    if (answers.days !== "remember" && !answers.style) {
      return {
        id: "style",
        text: `For the ${region} work: strength or mobility?`,
        choices: [
          { label: "Strength", value: "strength" },
          { label: "Mobility & function", value: "mobility" },
        ],
        fallback: req.emphasis,
      };
    }
    return null;
  }

  if (!answers.how) {
    const mobility = req.emphasis === "mobility";
    return {
      id: "how",
      text: mobility
        ? `How much room should ${region} mobility get?`
        : `How should Pivot add ${region} strength?`,
      choices: [
        { label: mobility ? "Add ~10 min to existing days" : "Add a few moves to existing days", value: "block" },
        ...(mobility && candidates(req, "swap", plan, today).length ? [{ label: `Swap ${region} strength moves for mobility`, value: "swap" }] : []),
        { label: `Make one day a ${region} ${req.emphasis} day`, value: "day" },
        { label: "Keep my plan, just remember it", value: "remember" },
      ],
      fallback: "block",
    };
  }
  if (answers.how === "remember") return null;
  if (!answers.days) {
    const days = candidates(req, answers.how, plan, today);
    if (!days.length) return null;
    const single = answers.how === "day";
    return {
      id: "days",
      text: single ? "Which day?" : "Which days?",
      choices: [...days.map(dayChoice), ...(!single && days.length > 1 ? [{ label: "All of these", value: "all" }] : [])],
      fallback: single ? days[0].id : days.length > 1 ? "all" : days[0].id,
    };
  }
  if (answers.how === "block" && !answers.trim) {
    const other = req.region === "lower" ? "upper" : "lower";
    return {
      id: "trim",
      text: `To keep the same length, what gets a little shorter?`,
      choices: [
        { label: `${capital(region)} ${req.notStrength ? "strength moves" : "moves"}`, value: req.region },
        { label: `Keep ${REGION_LABEL[req.region]} as is, trim ${REGION_LABEL[other]}`, value: other },
      ],
      fallback: req.region,
    };
  }
  return null;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Starts the flow, or null when the request is specific enough to go straight through. */
export function needsClarification(message: string, plan: WeeklyPlan | null, today: IsoDate): Clarification | null {
  const request = parsePreferenceRequest(message);
  if (!plan || !request) return null;
  return { request, next: nextQuestion(request, {}, plan, today) };
}

// ---------- the change ----------

export interface PreferenceChange {
  operations: PlanOperation[];
  /** Workouts this change may touch. Anything else must stay exactly as it was. */
  scope: string[];
  /** What to remember, in plain words. */
  memory: string;
  bodyFocus: BodyFocus;
  /** Shown when the plan doesn't change (or couldn't). */
  note?: string;
}

/** The stated preference, kept so future plans follow it. */
export function bodyFocusFor(req: PreferenceRequest, style?: string): BodyFocus {
  if (req.kind === "shift") return { [req.region]: style === "mobility" ? "mobility" : "strength", [req.from!]: "less" };
  return { [req.region]: req.emphasis };
}

export function memoryFor(req: PreferenceRequest, style?: string): string {
  const region = capital(REGION_LABEL[req.region]);
  if (req.kind === "shift") {
    return `Prefers ${REGION_LABEL[req.region]} focus over ${REGION_LABEL[req.from!]}${style === "mobility" ? " (mobility & function)" : ""}.`;
  }
  return req.emphasis === "mobility"
    ? `${region}: mobility & function${req.notStrength ? ", not strength/hypertrophy" : ""}.`
    : `${region}: wants more strength work.`;
}

/**
 * Turn the answers into the smallest plan change that does what was asked.
 * Only the chosen days are touched; on those days only the moves that have
 * to change are changed. Day, time and length always stay.
 */
export function buildPreferenceChange(
  req: PreferenceRequest,
  answers: ClarifyAnswers,
  plan: WeeklyPlan,
  profile: FitnessProfile,
  today: IsoDate,
): PreferenceChange {
  const style = answers.style ?? req.emphasis;
  const base = { memory: memoryFor(req, style), bodyFocus: bodyFocusFor(req, style) };
  const how = req.kind === "shift" ? "shift" : (answers.how ?? "block");
  if (how === "remember" || answers.days === "remember") {
    return { ...base, operations: [], scope: [], note: "Okay, your plan stays as it is. I'll keep it in mind for future plans." };
  }
  const pool = candidates(req, how === "shift" ? undefined : how, plan, today);
  const chosen = !answers.days || answers.days === "all" ? (how === "day" || how === "shift" ? pool.slice(0, 1) : pool) : pool.filter((w) => w.id === answers.days);
  const targets = how === "shift" && answers.days === "all" ? pool : chosen;
  const operations: PlanOperation[] = [];
  const skipped: string[] = [];
  for (const w of targets) {
    let next: Workout | null = null;
    if (how === "block") {
      next =
        req.emphasis === "mobility"
          ? addMobilityBlock(w, req.region, profile, 10, (answers.trim as TrimFrom) ?? req.region)
          : rebuildMoves(w, req.region, profile);
    } else if (how === "swap") next = swapRegionForMobility(w, req.region, profile);
    else next = rebuildForRegion(w, req.region, style === "mobility" ? "mobility" : "strength", profile);
    // Strength moved onto a lower-body day must not sit next to another one.
    if (next && isLowerBody(next) && plan.workouts.some((o) => o.id !== w.id && o.status !== "skipped" && isLowerBody(o) && Math.abs(Date.parse(o.date) - Date.parse(w.date)) === 86_400_000)) {
      next = rebuildForRegion(w, req.region, "mobility", profile);
    }
    if (next) operations.push({ op: "replace", workoutId: w.id, workout: next });
    else skipped.push(`${w.title} (${formatDate(w.date)})`);
  }
  return {
    ...base,
    operations,
    scope: targets.map((w) => w.id),
    note: !operations.length ? "There wasn't a day this could change without breaking your other rules, so I'll just remember it." : skipped.length ? `Left ${skipped.join(", ")} as is.` : undefined,
  };
}

/** "Add a few moves": swap in one or two region strength moves for the last moves of another region. */
function rebuildMoves(w: Workout, region: Region, profile: FitnessProfile): Workout | null {
  const rebuilt = rebuildForRegion(w, region, "strength", profile);
  if (!rebuilt) return null;
  const add = rebuilt.exercises.filter((we) => !w.exercises.some((x) => x.exerciseId === we.exerciseId)).slice(0, 2);
  if (!add.length) return null;
  const keep = w.exercises.slice(0, Math.max(1, w.exercises.length - add.length));
  const exercises = [...keep, ...add];
  const list = exercises.map((we) => getExercise(we.exerciseId)!);
  return {
    ...w,
    title: `${w.title} + ${REGION_LABEL[region]}`,
    exercises,
    muscles: [...new Set(list.flatMap((e) => e.muscles))],
    equipment: [...new Set(list.flatMap((e) => e.equipment))],
  };
}

// ---------- proportionality, enforced in code ----------

const sameWork = (a: Workout, b: Workout) =>
  a.category === b.category && JSON.stringify(a.exercises) === JSON.stringify(b.exercises) && JSON.stringify([...a.muscles].sort()) === JSON.stringify([...b.muscles].sort());

/**
 * A preference-level change may only touch the workouts in its scope. Any
 * other workout whose format, focus or exercises changed is a violation:
 * "maintain lower-body mobility" can't rewrite an upper-body day.
 */
export function outOfScopeChanges(previous: WeeklyPlan, next: WeeklyPlan, scope: string[]): Workout[] {
  const allowed = new Set(scope);
  return previous.workouts.filter((p) => {
    if (allowed.has(p.id) || p.status !== "planned") return false;
    const n = next.workouts.find((w) => w.id === p.id);
    return !!n && n.status === "planned" && !sameWork(p, n);
  });
}

/** For model options on a preference-level message: the workouts that train the region (or are being shifted from). */
export function preferenceScope(req: PreferenceRequest, plan: WeeklyPlan): string[] {
  return plan.workouts
    .filter((w) => trainsRegion(w, req.region) || (req.from && trainsRegion(w, req.from)) || ["mobility", "yoga"].includes(w.category))
    .map((w) => w.id);
}
