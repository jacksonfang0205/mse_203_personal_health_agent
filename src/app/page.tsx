import { CategoryIcon, Shield, Sparkle } from "@/components/icons";
import { StartButton } from "@/components/StartButton";
import { Card, Eyebrow, cx } from "@/components/ui";
import { CATEGORY_STYLE } from "@/lib/labels";
import type { WorkoutCategory } from "@/lib/schemas";

const PREVIEW: { day: string; title: string; time: string; category: WorkoutCategory; tilt: string }[] = [
  { day: "Tue", title: "Lower body strength", time: "45 min · any time", category: "strength", tilt: "-rotate-2" },
  { day: "Thu", title: "Easy run", time: "30 min · any time", category: "cardio", tilt: "rotate-1 translate-x-8" },
  { day: "Sat", title: "Yoga flow", time: "40 min · any time", category: "yoga", tilt: "-rotate-1 translate-x-2" },
];

const FEATURES = [
  {
    title: "Today's workout, on your terms",
    body: "Pivot picks the days and sizes each workout to how busy that day is. You do it whenever suits you and tick it off.",
  },
  {
    title: "Life Happens, in plain English",
    body: "Midterm tomorrow? Gym closed? Say what changed and pick from up to three options, each with its tradeoffs spelled out.",
  },
  {
    title: "Remembers what matters",
    body: "Your goals, your no-go exercises, the swaps you liked. You approve every change before it's saved.",
  },
];

export default function Home() {
  return (
    <div className="overflow-hidden">
      <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 pt-14 pb-20 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:pt-24">
        <div className="animate-rise">
          <Eyebrow className="text-coral-deep">An AI fitness planner for busy weeks</Eyebrow>
          <h1 className="mt-4 font-display text-6xl leading-[0.98] font-medium tracking-tight sm:text-7xl">
            Fitness that <em className="text-coral">fits</em> your life.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-soft">
            Open Pivot, see today&apos;s workout, tick it off. Pivot plans the week around how busy each day is and adjusts when
            it doesn&apos;t go to plan.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <StartButton />
            <span className="text-sm text-ink-faint">About 2 minutes. No account needed.</span>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-md" aria-hidden>
          <div className="absolute -top-10 -left-10 h-64 w-64 rounded-full bg-coral-soft blur-3xl" />
          <div className="absolute -right-8 -bottom-8 h-56 w-56 rounded-full bg-sky-soft blur-3xl" />
          <div className="relative flex flex-col gap-4">
            {PREVIEW.map((p, i) => {
              const style = CATEGORY_STYLE[p.category];
              return (
                <div
                  key={p.title}
                  style={{ animationDelay: `${120 + i * 90}ms` }}
                  className={cx("animate-rise rounded-2xl border p-5 shadow-card", style.soft, style.border, p.tilt)}
                >
                  <div className="flex items-center justify-between">
                    <span className={cx("inline-flex items-center gap-1.5 text-xs font-semibold", style.text)}>
                      <CategoryIcon category={p.category} width={15} height={15} /> {style.label}
                    </span>
                    <span className="text-xs font-semibold text-ink-faint">{p.day}</span>
                  </div>
                  <p className="mt-2 font-display text-xl font-semibold">{p.title}</p>
                  <p className="mt-1 text-sm text-ink-soft">{p.time}</p>
                </div>
              );
            })}
            <div
              style={{ animationDelay: "480ms" }}
              className="animate-rise ml-6 rounded-2xl bg-ink p-5 text-paper shadow-lift"
            >
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-coral">
                <Sparkle width={14} height={14} /> Life Happens
              </p>
              <p className="mt-2 text-sm text-paper/85">&ldquo;Midterm Thursday. Can we move my run?&rdquo;</p>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
                <span className="rounded-full bg-paper/10 px-2.5 py-1">20-min version</span>
                <span className="rounded-full bg-paper/10 px-2.5 py-1">Move to Friday</span>
                <span className="rounded-full bg-paper/10 px-2.5 py-1">Yoga instead</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-line bg-paper-deep/50">
        <div className="mx-auto grid max-w-6xl gap-5 px-5 py-16 sm:px-8 md:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Card key={f.title} className="p-6">
              <span className="font-display text-3xl font-medium text-coral">0{i + 1}</span>
              <h2 className="mt-3 font-display text-xl font-semibold">{f.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{f.body}</p>
            </Card>
          ))}
        </div>
        <p className="mx-auto flex max-w-6xl items-center gap-2 px-5 pb-12 text-xs text-ink-faint sm:px-8">
          <Shield width={14} height={14} /> Every suggested plan passes deterministic checks for calendar conflicts, time limits,
          equipment, and the exercises you avoid.
        </p>
      </section>
    </div>
  );
}
