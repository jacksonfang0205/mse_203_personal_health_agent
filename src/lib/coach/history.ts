/**
 * What the coach box keeps showing. Once something is done it drops out:
 * an option whose workout was completed, skipped or has passed (e.g. ticked
 * off in Today while the options were open), and a "Remember:" suggestion
 * that is already in memory. Nothing here is deleted; it just isn't shown.
 */
import type { MemorySuggestions } from "../agent/lifeHappens";
import type { Alternative, BlockedTime, IsoDate, MemoryNote, WeeklyPlan } from "../schemas";

/** An option is still actionable when every workout it changes is still planned and not in the past. */
export function stillActionable(alt: Alternative, plan: WeeklyPlan, today: IsoDate): boolean {
  return alt.operations.every((op) => {
    if (op.op === "add") return op.workout.date >= today;
    const w = plan.workouts.find((x) => x.id === op.workoutId);
    return !!w && w.status === "planned" && w.date >= today;
  });
}

const sameBlock = (a: BlockedTime, b: BlockedTime) =>
  a.start === b.start && a.end === b.end && (a.date ?? "") === (b.date ?? "") && [...a.days].sort().join() === [...b.days].sort().join();

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** Memory suggestions minus anything already saved. */
export function unsavedMemory(m: MemorySuggestions | null, saved: { blocked: BlockedTime[]; notes: MemoryNote[] }): MemorySuggestions | null {
  if (!m) return null;
  const blocked = m.blocked.filter((b) => !saved.blocked.some((x) => sameBlock(x, b)));
  const notes = m.notes.filter((n) => !saved.notes.some((x) => norm(x.text) === norm(n.text)));
  return blocked.length || notes.length ? { blocked, notes } : null;
}
