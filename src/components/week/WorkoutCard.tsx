import { CATEGORY_STYLE, MUSCLE_LABELS } from "@/lib/labels";
import type { Workout } from "@/lib/schemas";
import { CategoryIcon, Check, Clock, SkipIcon } from "../icons";
import { cx } from "../ui";

export function StatusPill({ status }: { status: Workout["status"] }) {
  if (status === "planned") return null;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        status === "completed" ? "bg-sage text-white" : "bg-ink/10 text-ink-soft",
      )}
    >
      {status === "completed" ? <Check width={12} height={12} /> : <SkipIcon width={12} height={12} />}
      {status === "completed" ? "Done" : "Skipped"}
    </span>
  );
}

export function WorkoutCard({ workout, onOpen }: { workout: Workout; onOpen: () => void }) {
  const style = CATEGORY_STYLE[workout.category];
  const muscles = workout.muscles.filter((m) => m !== "full_body").slice(0, 3);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        "group flex w-full flex-col gap-3 rounded-2xl border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift",
        workout.status === "skipped" ? "border-dashed border-line-strong bg-transparent opacity-60" : cx(style.soft, style.border),
        workout.status === "completed" && "opacity-80",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cx("inline-flex items-center gap-1.5 text-xs font-semibold", style.text)}>
          <CategoryIcon category={workout.category} width={15} height={15} />
          {style.label}
        </span>
        <StatusPill status={workout.status} />
      </div>
      <h3
        className={cx(
          "font-display text-lg leading-snug font-semibold text-ink",
          workout.status === "skipped" && "line-through decoration-ink/30",
        )}
      >
        {workout.title}
      </h3>
      <div className="flex items-center gap-1.5 text-xs text-ink-soft">
        <Clock width={14} height={14} />
        {workout.durationMin} min · any time
      </div>
      {muscles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {muscles.map((m) => (
            <span key={m} className="rounded-full bg-card/80 px-2 py-0.5 text-[11px] font-medium text-ink-soft">
              {MUSCLE_LABELS[m]}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
