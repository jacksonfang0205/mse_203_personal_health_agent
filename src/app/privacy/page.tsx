import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy · Pivot" };

export default function PrivacyPage() {
  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-4 px-5 py-12 text-ink-soft sm:px-8 [&_h2]:mt-4 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-ink">
      <h1 className="font-display text-4xl font-medium text-ink">Privacy policy</h1>
      <p>
        Pivot is a student class project for Stanford MS&amp;E 203. It plans workouts around your week. This page explains what
        it collects and why. Last updated November 11, 2026.
      </p>

      <h2>What we collect</h2>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          <strong>Your Google account basics.</strong> When you sign in with Google we receive your name, email address and
          profile picture, used only to identify your account.
        </li>
        <li>
          <strong>Your plan data.</strong> Your fitness profile (goals, equipment, schedule preferences, things you avoid), your
          weekly plan, workout progress, notes and times you can&apos;t work out. When you are signed in, this is saved to our
          database (Neon Postgres) so it follows you between devices. Without signing in, including in demo mode, it stays in
          your browser only.
        </li>
        <li>
          <strong>Google Calendar, only if you choose to import it.</strong> If you click &ldquo;Import Google Calendar&rdquo;, we
          ask Google for read-only access and read the next week of events from your primary calendar. We keep only the busy
          times (date, start and end), never event titles, descriptions or attendees. Google&apos;s access tokens are stored on
          our server so the import can run, and are never sent to your browser.
        </li>
        <li>
          <strong>Form correction.</strong> Videos stay on your device. Pose tracking runs in your browser, and only joint
          positions and your notes about the set are sent to our server for analysis.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Only to plan and adjust your workouts. To do that, your profile, plan, messages to the coach and form measurements are
        sent to an AI model through the Stanford AI API Gateway. We don&apos;t sell your data, share it with anyone else, or use
        it for advertising.
      </p>

      <h2>Deleting your data</h2>
      <p>
        Open Preferences, then Study tools, and choose <strong>Reset all data</strong>. This clears your profile and plan from
        this browser and from your account. Signing out also clears this browser. To have your account removed entirely,
        contact the Pivot team via the course.
      </p>

      <h2>Contact</h2>
      <p>Questions about this policy: contact the Pivot team via Stanford MS&amp;E 203.</p>
    </article>
  );
}
