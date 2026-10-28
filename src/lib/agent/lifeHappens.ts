/**
 * Agent Life Happens: the model reads what changed, proposes up to three
 * alternatives as plan operations, and suggests what to remember. Every
 * alternative is rebuilt from the catalog and validated against the calendar
 * plus whatever the message added (new events, time limits, equipment). If
 * nothing survives, the model gets one repair round with the violations, then
 * the rule-based options are used, and finally an honest "nothing fits".
 */
import { z } from "zod";
import { blockedToBusy } from "../calendar";
import { proposeRuleBasedAlternatives, applyOperations } from "../planner/alternatives";
import { buildWorkout, filterFromProfile, findSlotWithFallback } from "../planner/generate";
import {
  ALTERNATIVE_KINDS,
  ClockTime,
  Equipment,
  IsoDate,
  MuscleGroup,
  Weekday,
  WorkoutCategory,
  type Alternative,
  type BlockedTime,
  type BusyBlock,
  type MemoryNote,
  type PlanOperation,
  type Proposal,
  type WeeklyPlan,
} from "../schemas";
import { dayLong, formatTime, weekdayOf } from "../time";
import { validatePlan, type ValidationContext } from "../validation";
import {
  assembleWorkout,
  catalogFor,
  conflicts,
  daysContext,
  memoryContext,
  profileContext,
  remainingDates,
  repairStart,
  weekContext,
  type AgentRequest,
} from "./context";
import { callTool, type LlmResult } from "./llm";

const opt = <T extends z.ZodType>(s: T) => s.nullish();

const Operation = z.object({
  op: z.enum(["move", "replace", "skip"]),
  workoutId: z.string().describe("id from <plan>"),
  date: opt(IsoDate).describe("move/replace: new date"),
  start: opt(ClockTime).describe("move/replace: new start, inside a free window"),
  category: opt(WorkoutCategory).describe("replace: format of the new session"),
  minutes: opt(z.number()).describe("replace: new length"),
  focus: opt(z.array(MuscleGroup)),
  exerciseIds: opt(z.array(z.string())).describe("replace: ids from <catalog>"),
  title: opt(z.string()).describe("replace: 2-4 words"),
});

const LifeHappensOutput = z.object({
  understood: z.array(z.string()).max(3).describe("what changed, as short plain statements"),
  new_busy: z
    .array(z.object({ date: IsoDate, start: ClockTime, end: ClockTime, title: z.string() }))
    .max(10)
    .describe("events from the message that are not in the calendar yet"),
  day_limits: z
    .array(z.object({ date: IsoDate, minutes: z.number() }))
    .max(7)
    .describe("e.g. 'only 20 minutes Friday'; 0 = no time that day"),
  equipment_available: opt(z.array(Equipment)).describe("set only if the message changes what equipment is available"),
  alternatives: z
    .array(
      z.object({
        kind: z.enum(ALTERNATIVE_KINDS),
        title: z.string().describe("at most 6 words"),
        summary: z.string().describe("one sentence: what happens, with day and time"),
        tradeoffs: z.array(z.string()).max(2).describe("honest costs; never claim it's equivalent"),
        operations: z.array(Operation).min(1).max(7),
      }),
    )
    .max(3),
  infeasible_reason: opt(z.string()).describe("set only when no option fits"),
  remember: z
    .array(
      z.object({
        type: z.enum(["blocked", "note"]),
        text: z.string().describe("note text, or a short label for the blocked time"),
        days: opt(z.array(Weekday)).describe("blocked: recurring weekdays"),
        start: opt(ClockTime),
        end: opt(ClockTime),
      }),
    )
    .max(3)
    .describe(
      "only durable facts in the user's words, like 'I can never…' or 'every Tuesday…', or lasting preferences. One-off events (a midterm, a meeting this Thursday) go ONLY in new_busy or day_limits, never here.",
    ),
});
type LifeHappensOutput = z.infer<typeof LifeHappensOutput>;

const SYSTEM = `You are Pivot's Life Happens agent. The user says what changed in their week; you offer up to three different, feasible ways to adapt their workout plan.

Rules:
- First record the facts: a day that is "out" or fully busy goes in day_limits with minutes 0; a time-limited day ("only 20 minutes") gets its minutes; specific new events go in new_busy; recurring times the user can never work out go in remember AND count as busy now.
- Every alternative should resolve ALL of it: each planned workout that now conflicts should be moved, replaced, or skipped in that same alternative. Never put two workouts on one day.
- Only change planned workouts that the message affects. Never touch completed workouts. Never add make-up sessions or extra volume.
- Offer distinct kinds where possible: "shorter" (replace with a shorter session), "move" (same workout, another free slot), "swap_format" (replace with a different format that fits), "skip" (rest; always an honest option).
- Every new start must fit inside a free window from <days>, after any new_busy events from the message.
- If the message limits equipment for a period, every remaining workout in that period must fit it, so include operations for each one.
- Use exercise ids from <catalog> only. Minutes never exceed max_session_minutes.
- Use memory: lean toward the kinds of options the user picked before, and avoid times they usually miss.
- Tradeoffs must be honest. Never say a different workout gives the same benefit. No medical or rehab advice.
- Be concise. If nothing fits, return no alternatives and say why in infeasible_reason.`;

export interface MemorySuggestions {
  blocked: BlockedTime[];
  notes: MemoryNote[];
}

export interface LifeHappensResult {
  proposal: Proposal;
  memory: MemorySuggestions;
  usage: LlmResult<unknown>["usage"][];
  fallback?: string;
}

function buildPrompt(req: AgentRequest & { message: string }, plan: WeeklyPlan, busy: BusyBlock[], repair?: string) {
  const { weekStart } = weekContext(req);
  const filter = filterFromProfile(req.profile);
  return [
    `Today is ${req.now.date} (${req.now.time}). The user says: "${req.message}"`,
    `<profile>${JSON.stringify(profileContext(req.profile))}</profile>`,
    `<memory>${JSON.stringify(memoryContext(req))}</memory>`,
    `<plan>${JSON.stringify(
      plan.workouts.map((w) => ({
        id: w.id,
        date: w.date,
        start: w.start,
        minutes: w.durationMin,
        category: w.category,
        title: w.title,
        focus: w.muscles,
        equipment: w.equipment,
        status: w.status,
      })),
    )}</plan>`,
    `<days>${JSON.stringify(daysContext(remainingDates(weekStart, req.now.date), busy, plan.workouts.filter((w) => w.status !== "skipped"), req.now))}</days>`,
    `<catalog>${JSON.stringify(catalogFor(filter))}</catalog>`,
    repair ?? "",
  ].join("\n");
}

function toOperations(
  ops: LifeHappensOutput["alternatives"][number]["operations"],
  req: AgentRequest,
  plan: WeeklyPlan,
  ctx: ValidationContext,
  summary: string,
): PlanOperation[] | null {
  const filter = filterFromProfile(req.profile, ctx.equipmentAvailable ? { equipment: ctx.equipmentAvailable } : {});
  const out: PlanOperation[] = [];
  let working = plan;
  for (const op of ops) {
    const target = plan.workouts.find((w) => w.id === op.workoutId);
    if (!target || target.status === "completed") return null;
    const others = working.workouts.filter((w) => w.id !== target.id);
    let next: PlanOperation;
    if (op.op === "skip") {
      next = { op: "skip", workoutId: target.id };
    } else if (op.op === "move") {
      if (!op.date || !op.start) return null;
      const moved = repairStart({ ...target, date: op.date, start: op.start }, ctx.busy, others, req.profile, req.now);
      if (!moved) return null;
      next = { op: "move", workoutId: target.id, date: moved.date, start: moved.start };
    } else {
      const built = assembleWorkout(
        {
          date: op.date ?? target.date,
          start: op.start ?? target.start,
          category: op.category ?? target.category,
          minutes: op.minutes ?? target.durationMin,
          focus: op.focus ?? target.muscles,
          exerciseIds: op.exerciseIds ?? [],
          title: op.title ?? target.title,
          rationale: summary,
        },
        { id: target.id, profile: req.profile, filter },
      );
      const placed = built && repairStart(built, ctx.busy, others, req.profile, req.now);
      if (!placed) return null;
      next = { op: "replace", workoutId: target.id, workout: placed };
    }
    out.push(next);
    working = applyOperations(working, [next]);
  }
  return out;
}

/**
 * After an alternative's own operations, fix any *other* planned workout the
 * message knocked out (new events, a day with no time, missing equipment):
 * rebuild it to fit, move it to a free slot, or skip it. Each fix is spelled
 * out as a tradeoff so nothing changes silently.
 */
export function resolveCollateral(plan: WeeklyPlan, ops: PlanOperation[], ctx: ValidationContext, req: AgentRequest) {
  const touched = new Set(ops.map((o) => (o.op === "add" ? o.workout.id : o.workoutId)));
  const filter = filterFromProfile(req.profile, ctx.equipmentAvailable ? { equipment: ctx.equipmentAvailable } : {});
  const have = new Set(ctx.equipmentAvailable ?? req.profile.equipment);
  const limits = ctx.dateLimits ?? {};
  let working = applyOperations(plan, ops);
  const extra: PlanOperation[] = [];
  const notes: string[] = [];

  for (const w of plan.workouts) {
    if (w.status !== "planned" || touched.has(w.id) || w.date < req.now.date) continue;
    const others = working.workouts.filter((o) => o.id !== w.id && o.status !== "skipped");
    const limit = limits[w.date];
    const needsEquip = w.equipment.some((e) => !have.has(e));
    const tooLong = limit !== undefined && limit > 0 && w.durationMin > limit;
    if (limit !== 0 && !needsEquip && !tooLong && !conflicts(w, ctx.busy, others)) continue;

    let op: PlanOperation | null = null;
    let note = "";
    if (limit !== 0 && (needsEquip || tooLong)) {
      const minutes = tooLong ? limit : w.durationMin;
      const rebuilt =
        minutes >= 10 &&
        buildWorkout({
          category: w.category,
          focus: w.muscles,
          minutes,
          filter,
          workoutTypes: req.profile.workoutTypes,
          id: w.id,
          date: w.date,
          start: w.start,
          origin: "agent",
          rationale: w.rationale,
          title: w.title,
        });
      const placed = rebuilt && repairStart(rebuilt, ctx.busy, others, req.profile, req.now);
      if (placed) {
        op = { op: "replace", workoutId: w.id, workout: placed };
        note = `${w.title} on ${dayLong(w.date)} becomes ${minutes} min${needsEquip ? " with the equipment you have" : ""}.`;
      }
    }
    if (!op && limit !== 0 && !needsEquip) {
      const moved = repairStart(w, ctx.busy, others, req.profile, req.now);
      if (moved) {
        op = { op: "move", workoutId: w.id, date: moved.date, start: moved.start };
        note = `${w.title} moves to ${formatTime(moved.start)} on ${dayLong(w.date)}.`;
      }
    }
    if (!op && !needsEquip) {
      for (const date of remainingDates(plan.weekStart, req.now.date)) {
        if (date === w.date || others.some((o) => o.date === date) || (limits[date] !== undefined && limits[date]! < w.durationMin)) continue;
        const slot = findSlotWithFallback(
          { date, minutes: w.durationMin, busy: ctx.busy, taken: others, notBefore: req.now },
          req.profile.preferredTimes,
        );
        if (slot) {
          op = { op: "move", workoutId: w.id, date, start: slot.start };
          note = `${w.title} moves to ${dayLong(date)} at ${formatTime(slot.start)}.`;
          break;
        }
      }
    }
    if (!op) {
      op = { op: "skip", workoutId: w.id };
      note = `${w.title} on ${dayLong(w.date)} is skipped; no other time works.`;
    }
    extra.push(op);
    notes.push(note);
    working = applyOperations(working, [op]);
  }
  return { operations: [...ops, ...extra], notes };
}

function gate(out: LifeHappensOutput, req: AgentRequest, plan: WeeklyPlan, ctx: ValidationContext) {
  const valid: Alternative[] = [];
  const problems: string[] = [];
  out.alternatives.forEach((a, i) => {
    const own = toOperations(a.operations, req, plan, ctx, a.summary);
    if (!own) {
      problems.push(`Option ${i + 1} ("${a.title}"): an operation referenced an unknown or completed workout, or no free slot fits.`);
      return;
    }
    const { operations, notes } = resolveCollateral(plan, own, ctx, req);
    const check = validatePlan(applyOperations(plan, operations), ctx);
    if (!check.ok) {
      problems.push(`Option ${i + 1} ("${a.title}"): ${check.violations.map((v) => v.message).join(" ")}`);
      return;
    }
    valid.push({
      id: `${crypto.randomUUID()}-${a.kind}`,
      kind: a.kind,
      title: a.title,
      summary: a.summary,
      tradeoffs: [...a.tradeoffs, ...notes].length ? [...a.tradeoffs, ...notes] : ["No major downside."],
      operations,
    });
  });
  return { valid, problems };
}

/** Checks include what the message added: new events, times to remember, limits, equipment. */
function validationContext(req: AgentRequest, out: LifeHappensOutput, plan: WeeklyPlan): ValidationContext {
  const base = weekContext(req);
  const remembered = blockedToBusy(memorySuggestions(out, req).blocked, base.knownRange).map(
    (b): BusyBlock => ({ ...b, source: "user_message" }),
  );
  const dateLimits = Object.fromEntries(out.day_limits.map((d) => [d.date, Math.max(0, Math.round(d.minutes))]));
  return {
    profile: req.profile,
    busy: [...base.busy, ...remembered],
    knownRange: base.knownRange,
    now: req.now,
    previousPlan: plan,
    dateLimits,
    equipmentAvailable: out.equipment_available ?? undefined,
  };
}

function memorySuggestions(out: LifeHappensOutput, req: AgentRequest): MemorySuggestions {
  const at = new Date().toISOString();
  const blocked: BlockedTime[] = [];
  const notes: MemoryNote[] = [];
  // A recurring block that just restates a one-off event from this message is dropped.
  const oneOffWeekdays = new Set(out.new_busy.map((b) => `${weekdayOf(b.date)} ${b.start} ${b.end}`));
  const seen = new Set<string>();
  for (const r of out.remember) {
    if (r.type === "note") {
      if (r.text.trim()) notes.push({ id: crypto.randomUUID(), text: r.text.trim().slice(0, 300), source: "agent", createdAt: at });
    } else if (r.days?.length && r.start && r.end && r.end > r.start) {
      const key = `${[...r.days].sort().join(",")} ${r.start} ${r.end}`;
      const restatesOneOff = r.days.length === 1 && oneOffWeekdays.has(`${r.days[0]} ${r.start} ${r.end}`);
      const dup = seen.has(key) || req.blocked.some((b) => !b.date && b.start === r.start && b.end === r.end && r.days!.every((d) => b.days.includes(d)));
      seen.add(key);
      if (!dup && !restatesOneOff) {
        blocked.push({ id: crypto.randomUUID(), days: r.days, start: r.start, end: r.end, label: r.text.trim().slice(0, 80), source: "agent", createdAt: at });
      }
    }
  }
  // One-off events from the message can be remembered for this date only.
  for (const b of out.new_busy) {
    if (b.end <= b.start) continue;
    const key = `${b.date} ${b.start} ${b.end}`;
    const dup = seen.has(key) || req.blocked.some((x) => x.date === b.date && x.start === b.start && x.end === b.end);
    seen.add(key);
    if (!dup) blocked.push({ id: crypto.randomUUID(), days: [], date: b.date, start: b.start, end: b.end, label: b.title.slice(0, 80), source: "agent", createdAt: at });
  }
  return { blocked, notes };
}

export async function agentLifeHappens(req: AgentRequest & { message: string }): Promise<LifeHappensResult> {
  const plan = req.plan;
  const at = new Date().toISOString();
  const base = { id: crypto.randomUUID(), createdAt: at, userMessage: req.message };
  if (!plan) {
    return {
      proposal: { ...base, understood: [], alternatives: [], infeasibleReason: "There's no plan for this week yet.", generatedBy: "agent" },
      memory: { blocked: [], notes: [] },
      usage: [],
    };
  }

  const call = (user: string) =>
    callTool({
      system: SYSTEM,
      user,
      name: "propose_alternatives",
      description: "Propose up to three ways to adapt the plan, plus anything worth remembering.",
      schema: LifeHappensOutput,
    });

  const { busy: calendarBusy } = weekContext(req);
  const first = await call(buildPrompt(req, plan, calendarBusy));
  const usage = [first.usage];
  let out = first.output;
  let ctx = validationContext(req, out, plan);
  let { valid, problems } = gate(out, req, plan, ctx);
  if (problems.length) console.info("life-happens: rejected options", problems);

  // One repair round: show the model exactly what failed.
  if (!valid.length && out.alternatives.length) {
    const repair = await call(
      buildPrompt(
        req,
        plan,
        ctx.busy,
        `<previous_attempt_failed>\n${problems.join("\n")}\nFix these and try again. Use only free windows listed in <days>.\n</previous_attempt_failed>`,
      ),
    );
    usage.push(repair.usage);
    out = { ...repair.output, new_busy: [...out.new_busy, ...repair.output.new_busy] };
    ctx = validationContext(req, out, plan);
    ({ valid, problems } = gate(out, req, plan, ctx));
    if (problems.length) console.info("life-happens: rejected after repair", problems);
  }

  let fallback: string | undefined;
  if (!valid.length && !out.infeasible_reason) {
    // Rule-based options still have to pass the message-aware checks.
    const rb = proposeRuleBasedAlternatives({
      plan,
      profile: req.profile,
      busy: ctx.busy,
      knownRange: ctx.knownRange,
      now: req.now,
      userMessage: req.message,
      proposalId: base.id,
      createdAt: at,
    });
    valid = rb.alternatives
      .map((a) => {
        const fixed = resolveCollateral(plan, a.operations, ctx, req);
        return { ...a, operations: fixed.operations, tradeoffs: [...a.tradeoffs, ...fixed.notes] };
      })
      .filter((a) => validatePlan(applyOperations(plan, a.operations), ctx).ok);
    if (valid.length) fallback = "The AI's options didn't pass the schedule checks, so these are rule-based.";
  }

  return {
    proposal: {
      ...base,
      understood: out.understood,
      alternatives: valid.slice(0, 3),
      infeasibleReason: valid.length ? undefined : (out.infeasible_reason ?? "No option fits your calendar and limits this week."),
      generatedBy: "agent",
    },
    memory: memorySuggestions(out, req),
    usage,
    fallback,
  };
}
