/**
 * "I can now do Wednesdays too." A newly free day is a preference, not a
 * disruption: it goes into the user's workout days, and the coach offers to use
 * it (move a workout that sits on a day they didn't pick, or add one) instead of
 * proposing skips and moves for unrelated workouts.
 */
import { GOAL_LABELS } from "../labels";
import { applyOperations } from "../planner/alternatives";
import { finalizeAlternative } from "../planner/describe";
import { applyBodyFocus } from "../planner/focus";
import { buildWorkout, categoryRotation, filterFromProfile, findSlotWithFallback, GOAL_CATEGORIES, STRENGTH_FOCI, windowLabelFor } from "../planner/generate";
import { WEEKDAYS, type Alternative, type FitnessProfile, type IsoDate, type PlanOperation, type Proposal, type Weekday, type WeeklyPlan, type Workout } from "../schemas";
import { addDays, dayLong, formatDate, planCovers, weekdayOf } from "../time";
import { isLowerBody, type ValidationContext } from "../validation";

const DAY_WORDS: Record<Weekday, RegExp> = {
  mon: /\bmon(day)?s?\b/i,
  tue: /\btue(s|sday)?s?\b/i,
  wed: /\bwed(nesday)?s?\b/i,
  thu: /\bthu(r|rs|rsday)?s?\b/i,
  fri: /\bfri(day)?s?\b/i,
  sat: /\bsat(urday)?s?\b/i,
  sun: /\bsun(day)?s?\b/i,
};

// "I can now do Wednesday", "I'm free on Wednesdays", "Wednesday works now", "add Wednesday to my days".
const AVAILABLE =
  /\b(can (now |also |)(do|make|train|work ?out)|(am|i'm|im) (now |also |)(free|available)|works? (for me )?now|is (now |)(free|open|available)|now (free|open|available)|open up|freed up|add\b[^.]{0,20}\bto my (days|schedule|week)|have time)\b/i;
const NEGATED = /\b(can'?t|cannot|can not|no longer|not free|not available|busy|won'?t)\b/i;

/** Weekdays the message says are newly free, or [] when it says something else. */
export function parseNewDays(message: string): Weekday[] {
  if (!AVAILABLE.test(message) || NEGATED.test(message)) return [];
  return WEEKDAYS.filter((d) => DAY_WORDS[d].test(message));
}

export interface NewDaysResult {
  profile: FitnessProfile;
  added: Weekday[];
  proposal: Proposal;
}

const DAY_NAME: Record<Weekday, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * Add the days to the profile and offer ways to use the next one of them this
 * week: move a workout that's on a day the user didn't pick, or add a workout.
 * `ctx` should already carry the updated profile.
 */
export function proposeForNewDays(args: {
  plan: WeeklyPlan;
  profile: FitnessProfile;
  days: Weekday[];
  ctx: Omit<ValidationContext, "profile">;
  today: IsoDate;
  message: string;
  id: string;
  createdAt: string;
}): NewDaysResult {
  const { plan, days, today } = args;
  const added = days.filter((d) => !args.profile.preferredDays.includes(d));
  const profile: FitnessProfile = {
    ...args.profile,
    preferredDays: WEEKDAYS.filter((d) => args.profile.preferredDays.includes(d) || days.includes(d)),
    updatedAt: args.createdAt,
  };
  const ctx: ValidationContext = { ...args.ctx, profile };
  const names = list(days.map((d) => `${DAY_NAME[d]}s`));
  const saved = added.length ? `Added ${names} to your workout days, so new plans use ${days.length > 1 ? "them" : "it"}.` : `${names} ${days.length > 1 ? "are" : "is"} already one of your workout days.`;

  // The next date of each new day that this plan still covers and hasn't passed.
  const dates = Array.from({ length: 7 }, (_, i) => addDays(today, i)).filter(
    (d) => days.includes(weekdayOf(d)) && planCovers(plan, d) && !plan.workouts.some((w) => w.date === d && w.status !== "skipped"),
  );
  const alternatives: Alternative[] = [];
  const offer = (alt: Omit<Alternative, "fit" | "bends" | "ask">) => {
    const done = finalizeAlternative(plan, alt, ctx);
    if (done) alternatives.push({ ...done, title: alt.title });
  };

  for (const date of dates) {
    // 1. A workout on a day the user didn't pick (often why a Sunday session appeared) moves to the new day.
    const offDay = plan.workouts
      .filter((w) => w.status === "planned" && w.date >= today && !args.profile.preferredDays.includes(weekdayOf(w.date)))
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    if (offDay) {
      const slot = slotOn(date, offDay.durationMin, plan, profile, ctx, offDay.id);
      if (slot) {
        const op: PlanOperation = { op: "move", workoutId: offDay.id, date, start: slot };
        if (!(isLowerBody(offDay) && legDayNextTo(applyOperations(plan, [op]), date, offDay.id))) {
          offer({
            id: `${args.id}-move-${date}`,
            kind: "move",
            title: `Move ${offDay.title} to ${dayLong(date)}`,
            summary: "",
            tradeoffs: [`${dayLong(offDay.date)} wasn't one of your days, so this puts the workout on a day you picked.`],
            operations: [op],
          });
        }
      }
    }
    // 2. Add a workout that day.
    // An extra workout raises the weekly target by one, so it's checked against that target.
    const extra = newWorkout(date, plan, profile, ctx, `${args.id}${ADD_MARK}${date}`);
    if (extra) {
      const more = withExtraWorkouts(profile, 1);
      const alt = finalizeAlternative(
        plan,
        {
          id: `${args.id}${ADD_MARK}${date}`,
          kind: "swap_format",
          title: `Add ${extra.title.toLowerCase()} on ${dayLong(date)}`,
          summary: "",
          tradeoffs: [`Your weekly target goes from ${profile.frequencyPerWeek} to ${more.frequencyPerWeek} workouts.`],
          operations: [{ op: "add", workout: extra }],
        },
        { ...ctx, profile: more },
      );
      if (alt) alternatives.push({ ...alt, title: `Add ${extra.title.toLowerCase()} on ${dayLong(date)}` });
    }
  }

  const next = dates[0];
  const understood = [
    next
      ? `${saved} Here's how to use ${formatDate(next)}.`
      : `${saved} There's no ${list(days.map((d) => DAY_NAME[d]))} left in this week's plan, so it starts with next week's.`,
  ];
  return {
    profile,
    added,
    proposal: {
      id: args.id,
      createdAt: args.createdAt,
      userMessage: args.message,
      understood,
      alternatives: alternatives.slice(0, 3),
      infeasibleReason: alternatives.length ? undefined : understood[0],
      generatedBy: "agent",
    },
  };
}

/** Marks an option that adds a workout for a newly free day; accepting it raises the weekly target. */
const ADD_MARK = "-newday-add-";

/** The profile to save when an option is accepted: adding a workout for a new day raises the weekly target. */
export function profileForAccepted(alt: Pick<Alternative, "id" | "operations">, profile: FitnessProfile): FitnessProfile {
  if (!alt.id.includes(ADD_MARK)) return profile;
  const adds = alt.operations.filter((o) => o.op === "add").length;
  return adds ? withExtraWorkouts(profile, adds) : profile;
}

function withExtraWorkouts(profile: FitnessProfile, n: number): FitnessProfile {
  return { ...profile, frequencyPerWeek: Math.min(14, profile.frequencyPerWeek + n) };
}

function legDayNextTo(plan: WeeklyPlan, date: IsoDate, exceptId?: string): boolean {
  return plan.workouts.some(
    (w) => w.id !== exceptId && w.status !== "skipped" && isLowerBody(w) && (w.date === addDays(date, -1) || w.date === addDays(date, 1)),
  );
}

function slotOn(date: IsoDate, minutes: number, plan: WeeklyPlan, profile: FitnessProfile, ctx: ValidationContext, exceptId?: string) {
  const taken = plan.workouts.filter((w) => w.id !== exceptId && w.status !== "skipped");
  const slot = findSlotWithFallback({ date, minutes, busy: ctx.busy, taken, notBefore: ctx.now }, profile.preferredTimes);
  return slot?.preferred ? slot.start : null;
}

/** A new workout for the day, balanced against its neighbours: no leg day next to a leg day. */
function newWorkout(date: IsoDate, plan: WeeklyPlan, profile: FitnessProfile, ctx: ValidationContext, id: string): Workout | null {
  const start = slotOn(date, profile.sessionMinutes, plan, profile, ctx);
  if (!start) return null;
  const filter = filterFromProfile(profile);
  const rotation = categoryRotation(profile, filter);
  // The format the week has least of, among the user's own rotation.
  const count = (c: string) => plan.workouts.filter((w) => w.status !== "skipped" && w.category === c).length;
  const category = [...rotation].sort((a, b) => count(a) - count(b) || rotation.indexOf(a) - rotation.indexOf(b))[0];
  const nearLegs = legDayNextTo(plan, date);
  const lowerCount = plan.workouts.filter((w) => w.status !== "skipped" && isLowerBody(w)).length;
  const upperCount = plan.workouts.filter((w) => w.status !== "skipped" && w.category === "strength" && w.muscles.some((m) => ["chest", "back", "shoulders", "arms"].includes(m)) && !isLowerBody(w)).length;
  const focus =
    category === "strength"
      ? (nearLegs || lowerCount > upperCount ? STRENGTH_FOCI[1] : STRENGTH_FOCI[0]).muscles
      : profile.targetMuscles;
  const goal = profile.goals.find((g) => GOAL_CATEGORIES[g].includes(category)) ?? profile.goals[0];
  const built = buildWorkout({
    category,
    focus,
    minutes: profile.sessionMinutes,
    filter,
    workoutTypes: profile.workoutTypes,
    id,
    date,
    start,
    origin: "mock_template",
    rationale: `Added because ${dayLong(date)} is now free. Works toward your goal to ${GOAL_LABELS[goal].label.toLowerCase()}. Placed in your free ${windowLabelFor(start)} on ${dayLong(date)}.`,
  });
  const w = built && applyBodyFocus(built, profile);
  if (!w || (isLowerBody(w) && nearLegs)) return null;
  return w;
}
