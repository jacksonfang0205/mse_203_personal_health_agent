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
  cue: "Cue",
};

export function FeedbackCard({ result, videoUrl, pose }: { result: FormCoachResponse; videoUrl: string; pose: PoseSequence }) {
  const [seek, setSeek] = useState<{ ms: number; nonce: number } | null>(null);
  const seekCount = useRef(0);
  const f = result.feedback;
  const guide = MOVEMENTS[result.movement.id];
  const faultLabels = useMemo(() => Object.fromEntries((guide?.faults ?? []).map((x) => [x.id, x.label])), [guide]);
  const overlay = useMemo(
    () => ({ side: result.overlay.side, primary: result.overlay.primary, reps: result.reps, faultLabels, view: result.quality.view }),
    [result, faultLabels],
  );
  const jump = (n: number) => {
    const r = result.reps.find((x) => x.n === n);
    if (r) setSeek({ ms: r.bottomMs, nonce: ++seekCount.current });
  };
  // One list of things to do. "Film again" isn't shown here.
  // If the coach gave cues but no concrete changes, show the cues in the same section instead.
  const changes = f.changes.filter((c) => c.kind !== "retest");
  const items = changes.length ? changes : f.cues.map((c) => ({ kind: "cue", reason: c, exerciseName: undefined, drillName: undefined, drillHow: undefined, loadChangePct: undefined }));

  return (
    <div className="flex flex-col gap-4">
      <SkeletonPlayer videoUrl={videoUrl} pose={pose} overlay={overlay} seek={seek} />

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
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
            {f.findings.length === 1 ? "The problem" : `The problems (${f.findings.length})`}
          </p>
          {f.findings.map((x) => (
            <div key={x.faultId} className="rounded-2xl border border-coral/30 bg-coral-soft/50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{x.label}</p>
                <span className="text-xs text-ink-soft">{x.reps.length === 1 ? "rep" : "reps"}</span>
                {x.reps.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => jump(n)}
                    title={`Jump to rep ${n}`}
                    className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-coral-ink hover:bg-coral hover:text-white"
                  >
                    {n}
                  </button>
                ))}
              </div>
              {x.measured && <p className="mt-1 text-xs text-ink-soft">{x.measured.text}</p>}
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

      {items.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">What to do next set</p>
          {items.map((c, i) => (
            <div key={i} className="rounded-2xl border border-line bg-paper p-3 text-sm">
              <p>
                <span className="mr-2 rounded-full bg-sky-soft px-2 py-0.5 text-[11px] font-semibold text-sky-ink">{CHANGE_LABEL[c.kind] ?? c.kind}</span>
                <span className="font-semibold">{c.exerciseName ?? c.drillName ?? (c.loadChangePct ? `${c.loadChangePct}% load` : "")}</span>
              </p>
              <p className="mt-1 text-ink-soft">{c.drillHow ?? c.reason}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
