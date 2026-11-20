/**
 * "Ask before big changes." A vague request that would rewrite a whole day
 * or change its focus ("maintain lower-body mobility") gets one short
 * clarifying question with quick replies before anything changes. Small,
 * specific requests (a day, a time, a length, skip/move) go straight through.
 */
import type { IsoDate, WeeklyPlan, Workout } from "../schemas";
import { formatDate } from "../time";

export type ClarifyAction = "send" | "remember" | "dismiss";

export interface ClarifyChoice {
  label: string;
  action: ClarifyAction;
  /** "send": the specific request sent to the coach (marked as clarified). "remember": the note saved. */
  message?: string;
}

export interface Clarification {
  question: string;
  choices: ClarifyChoice[];
}

const FOCUS =
  /\b((?:lower|upper)[- ]?body(?:\s+(?:mobility|strength|flexibility|work|training))?|full[- ]body|mobility|flexibility|stretch(?:ing)?|legs?|glutes?|core|abs|arms|chest|shoulders?|cardio|endurance|conditioning|strength|yoga|pilates|hiit|recovery)\b/i;
const VAGUE =
  /\b(maintain|keep up|keep (?:my|some)|focus (?:on|more)|work on|more|improve|add some|incorporate|include|prioriti[sz]e|emphasi[sz]e|get better|want (?:to|some)|need (?:to|some)|should|balance)\b/i;
/** Anything that pins the request to a specific day, time, length, or action. */
const SPECIFIC =
  /\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?\b|\b(today|tonight|tomorrow|this (?:morning|afternoon|evening)|next (?:session|workout))\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b|\b\d+\s*-?\s*min|\b(skip|move|swap|replace|instead|cancel|reschedule|shorter|longer|busy|meeting|exam|midterm|can'?t|cannot|only have|sick|travel\w*|out of town|no time)\b/i;

export function needsClarification(message: string, plan: WeeklyPlan | null, today: IsoDate): Clarification | null {
  const text = message.replace(/’/g, "'");
  const focus = text.match(FOCUS)?.[1];
  if (!plan || !focus || !VAGUE.test(text) || SPECIFIC.test(text)) return null;
  const phrase = focus.toLowerCase().replace(/(lower|upper|full)\s?-?\s?body/, "$1-body");
  const target: Workout | undefined = plan.workouts
    .filter((w) => w.status === "planned" && w.date >= today)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];
  const choices: ClarifyChoice[] = [];
  if (target) {
    choices.push({
      label: `Make ${formatDate(target.date)} a ${phrase} day`,
      action: "send",
      message: `Change my ${target.title} on ${formatDate(target.date)} into a ${phrase} session. Keep the same day, time and length.`,
    });
  }
  choices.push({ label: "Keep my plan, just remember it", action: "remember", message: message.trim().slice(0, 300) });
  choices.push({ label: "Something else", action: "dismiss" });
  return {
    question: target
      ? `That would change a whole day. Turn ${target.title} on ${formatDate(target.date)} into ${phrase}, or keep your plan?`
      : `Should I change your plan for ${phrase}, or just remember it?`,
    choices,
  };
}
