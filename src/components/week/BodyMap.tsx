import { MUSCLE_LABELS } from "@/lib/labels";
import type { MuscleGroup } from "@/lib/schemas";

type Region = Exclude<MuscleGroup, "full_body">;

/** Simple front and back figures; each muscle group is a set of shapes. */
const FRONT: Partial<Record<Region, string[]>> = {
  shoulders: ["M30 44 q-9 2 -10 12 l9 2 z", "M90 44 q9 2 10 12 l-9 2 z"],
  chest: ["M33 46 h25 v16 q-12 4 -25 -2 z", "M62 46 h25 v14 q-13 6 -25 2 z"],
  arms: ["M20 58 l9 2 l-3 34 l-8 -1 z", "M100 58 l-9 2 l3 34 l8 -1 z"],
  core: ["M36 66 q24 8 48 0 l-2 32 q-22 6 -44 0 z"],
  legs: ["M38 104 h20 l-2 50 h-14 z", "M62 104 h20 l-4 50 h-14 z", "M42 158 h13 l-1 40 h-10 z", "M65 158 h13 l-2 40 h-10 z"],
};
const BACK: Partial<Record<Region, string[]>> = {
  shoulders: ["M30 44 q-9 2 -10 12 l9 2 z", "M90 44 q9 2 10 12 l-9 2 z"],
  back: ["M33 44 h54 l-6 46 q-21 6 -42 0 z"],
  arms: ["M20 58 l9 2 l-3 34 l-8 -1 z", "M100 58 l-9 2 l3 34 l8 -1 z"],
  glutes: ["M38 92 q22 -6 44 0 v18 q-22 6 -44 0 z"],
  legs: ["M38 112 h20 l-2 42 h-14 z", "M62 112 h20 l-4 42 h-14 z", "M42 158 h13 l-1 40 h-10 z", "M65 158 h13 l-2 40 h-10 z"],
};

function Figure({ regions, on, label }: { regions: Partial<Record<Region, string[]>>; on: Set<Region>; label: string }) {
  return (
    <figure className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 120 206" className="h-44 w-auto" aria-hidden>
        {/* silhouette */}
        <circle cx="60" cy="22" r="13" fill="var(--color-paper-deep)" />
        <rect x="52" y="34" width="16" height="10" rx="4" fill="var(--color-paper-deep)" />
        <path d="M28 44 h64 q8 0 10 14 l-2 40 h-8 l-2 -30 l-4 32 l2 52 l-4 52 h-14 l-4 -70 l-4 70 h-14 l-4 -52 l2 -52 l-4 -32 l-2 30 h-8 l-2 -40 q2 -14 10 -14 z" fill="var(--color-paper-deep)" />
        {(Object.keys(regions) as Region[]).map((r) =>
          regions[r]!.map((d, i) => (
            <path
              key={`${r}-${i}`}
              d={d}
              fill={on.has(r) ? "var(--color-coral)" : "var(--color-line-strong)"}
              opacity={on.has(r) ? 0.9 : 0.45}
              className="transition-colors duration-300"
            />
          )),
        )}
      </svg>
      <figcaption className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">{label}</figcaption>
    </figure>
  );
}

/** Front and back figures with today's target muscles highlighted. */
export function BodyMap({ muscles }: { muscles: MuscleGroup[] }) {
  const all = muscles.includes("full_body");
  const on = new Set<Region>(
    all ? ["shoulders", "chest", "arms", "core", "back", "glutes", "legs"] : (muscles.filter((m) => m !== "full_body") as Region[]),
  );
  const named = all ? ["Full body"] : muscles.map((m) => MUSCLE_LABELS[m]);
  return (
    <div className="flex flex-col items-center gap-3" role="img" aria-label={`Targets: ${named.join(", ")}`}>
      <div className="flex gap-2">
        <Figure regions={FRONT} on={on} label="Front" />
        <Figure regions={BACK} on={on} label="Back" />
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {named.map((m) => (
          <span key={m} className="rounded-full bg-coral-soft px-2.5 py-0.5 text-[11px] font-semibold text-coral-ink">
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}
