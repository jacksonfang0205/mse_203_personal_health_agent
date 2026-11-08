"use client";

import { useMemo, useRef, useState } from "react";
import type { FormCoachResponse } from "@/lib/form/coach";
import { MOVEMENTS } from "@/lib/form/movements";
import type { PoseSequence } from "@/lib/form/pose";
import { cx } from "../ui";
import { SkeletonPlayer } from "./SkeletonPlayer";

const CHANGE_LABEL: Record<string, string> = {
  regress_exercise: "Easier variation",
  swap_exercise: "Swap",
  reduce_load: "Lighter load",
  add_drill: "Drill",
  keep_going: "Keep going",
  retest: "Film again",
};

export function FeedbackCard({ result, videoUrl, pose }: { result: FormCoachResponse; videoUrl: string; pose: PoseSequence }) {
  const [seek, setSeek] = useState<{ ms: number; nonce: number } | null>(null);
  const [details, setDetails] = useState(false);
  const f = result.feedback;
  const guide = MOVEMENTS[result.movement.id];
  const faultLabels = useMemo(() => Object.fromEntries((guide?.faults ?? []).map((x) => [x.id, x.label])), [guide]);
  const overlay = useMemo(
    () => ({ side: result.overlay.side, primary: result.overlay.primary, reps: result.reps, faultLabels }),
    [result, faultLabels],
  );
  const seekCount = useRef(0);
  const jump = (n: number) => {
    const r = result.reps.find((x) => x.n === n);
    if (r) setSeek({ ms: r.bottomMs, nonce: ++seekCount.current });
  };

  return (
    <div className="flex flex-col gap-4">
      <SkeletonPlayer videoUrl={videoUrl} pose={pose} overlay={overlay} seek={seek} />

      {result.reps.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">Reps</span>
          {result.reps.map((r) => (
            <button
              key={r.n}
              type="button"
              onClick={() => jump(r.n)}
              title={r.faults.map((x) => faultLabels[x] ?? x).join(", ") || "No measured faults"}
              className={cx(
                "h-8 min-w-8 rounded-full px-2 text-xs font-semibold transition-colors",
                r.faults.length ? "bg-coral-soft text-coral-ink hover:bg-coral hover:text-white" : "bg-sage-soft text-sage-ink hover:bg-sage hover:text-white",
              )}
            >
              {r.n}
            </button>
          ))}
        </div>
      )}

      <div>
        <span
          className={cx(
            "inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider",
            result.generatedBy === "agent" ? "bg-ink text-paper" : "border border-dashed border-ink-faint/60 bg-paper-deep text-ink-soft",
          )}
        >
          {result.generatedBy === "agent" ? "AI coach" : "Rule-based review"}
        </span>
        <p className="mt-2 font-display text-2xl leading-snug font-semibold">{f.headline}</p>
        {f.praise && <p className="mt-1 text-sm text-sage-ink">{f.praise}</p>}
      </div>

      {f.findings.length > 0 && (
        <div className="flex flex-col gap-2">
          {f.findings.map((x) => (
            <div key={x.faultId} className="rounded-2xl border border-coral/30 bg-coral-soft/50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{x.label}</p>
                <span className="text-xs text-ink-soft">reps</span>
                {x.reps.map((n) => (
                  <button key={n} type="button" onClick={() => jump(n)} className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-coral-ink hover:bg-coral hover:text-white">
                    {n}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-sm">
                <span className="font-semibold">Likely cause: </span>
                {x.cause?.label ?? "Not clear yet"}
                <span className="ml-1.5 text-xs text-ink-faint">({x.confidence} confidence)</span>
              </p>
              {x.evidence && <p className="mt-1 text-sm text-ink-soft">{x.evidence}</p>}
            </div>
          ))}
        </div>
      )}

      {f.cues.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Think about this next set</p>
          {f.cues.map((c) => (
            <p key={c} className="mt-1 border-l-4 border-coral pl-3 font-display text-lg italic">
              {c}
            </p>
          ))}
        </div>
      )}

      {f.changes.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">What to change</p>
          {f.changes.map((c, i) => (
            <div key={i} className="rounded-2xl border border-line bg-paper p-3 text-sm">
              <p>
                <span className="mr-2 rounded-full bg-sky-soft px-2 py-0.5 text-[11px] font-semibold text-sky-ink">{CHANGE_LABEL[c.kind] ?? c.kind}</span>
                <span className="font-semibold">
                  {c.exerciseName ?? c.drillName ?? (c.loadChangePct ? `${c.loadChangePct}% load` : "")}
                </span>
              </p>
              {c.drillHow && <p className="mt-1 text-ink-soft">{c.drillHow}</p>}
              <p className="mt-1 text-ink-soft">{c.reason}</p>
            </div>
          ))}
        </div>
      )}

      {f.retest && (
        <p className="rounded-2xl bg-sky-soft/60 p-3 text-sm text-sky-ink">
          <span className="font-semibold">Next session: </span>
          {f.retest}
        </p>
      )}

      {f.cannotAssess.length > 0 && (
        <div className="text-sm text-ink-soft">
          <p className="font-semibold text-ink">What this clip can&apos;t show</p>
          <ul className="mt-1 list-disc pl-5">
            {f.cannotAssess.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <button type="button" onClick={() => setDetails((d) => !d)} className="self-start text-xs font-semibold text-ink-faint underline underline-offset-4">
        {details ? "Hide the measurements" : "Show the measurements"}
      </button>
      {details && (
        <div className="rounded-2xl bg-paper-deep p-3 font-mono text-xs leading-relaxed text-ink-soft">
          <p>
            {result.repCount} reps · {result.quality.durationS}s · {result.quality.view} view · tracked side: {result.quality.side} · joints visible in{" "}
            {Math.round(result.quality.usableFraction * 100)}% of frames
          </p>
          {result.measured.map((m) => (
            <p key={m.faultId}>
              {m.faultId}: {m.feature} {m.op} {m.threshold} on reps {m.reps.join(", ")} (worst {m.worst}, {m.pattern})
            </p>
          ))}
          <p>{result.golden.available ? `Golden set: ${result.golden.deviations.length} deviation(s); shape match ${result.golden.shapeSimilarity.join(", ")}` : result.golden.note}</p>
          {result.dropped.length > 0 && <p>Removed by the checks: {result.dropped.join("; ")}</p>}
        </div>
      )}
    </div>
  );
}
