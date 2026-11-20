import type { Metadata } from "next";
import { Suspense } from "react";
import { WeekSkeleton, WeekView } from "@/components/week/WeekView";

export const metadata: Metadata = { title: "My week · Pivot" };

export default function WeekPage() {
  // WeekView reads ?welcome (the plan reveal after onboarding), so it renders on the client.
  return (
    <Suspense fallback={<WeekSkeleton />}>
      <WeekView />
    </Suspense>
  );
}
