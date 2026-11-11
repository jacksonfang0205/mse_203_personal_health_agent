import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms · Pivot" };

export default function TermsPage() {
  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-4 px-5 py-12 text-ink-soft sm:px-8 [&_h2]:mt-4 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-ink">
      <h1 className="font-display text-4xl font-medium text-ink">Terms of service</h1>
      <p>Last updated November 11, 2026.</p>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          <strong>A class project.</strong> Pivot is a student prototype for Stanford MS&amp;E 203, provided as-is, without
          warranties of any kind. It may have bugs, change, or stop working at any time, and access may end after the course.
        </li>
        <li>
          <strong>Not medical advice.</strong> Pivot gives general fitness suggestions only. It does not diagnose, treat or
          rehabilitate anything. Talk to a doctor or qualified professional before exercising with an injury, a health
          condition, or pain, and stop any exercise that hurts.
        </li>
        <li>
          <strong>Your responsibility.</strong> You decide whether a suggested workout is right for you and are responsible for
          exercising safely.
        </li>
        <li>
          <strong>Your data.</strong> How we handle your data is described in the <a className="underline" href="/privacy">privacy policy</a>.
        </li>
      </ul>
      <p>Questions: contact the Pivot team via Stanford MS&amp;E 203.</p>
    </article>
  );
}
