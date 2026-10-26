"use client";

import { usePivotState } from "@/lib/store";
import { ArrowRight } from "./icons";
import { ButtonLink } from "./ui";

/** Landing CTA: resumes the user's week if they've already onboarded. */
export function StartButton() {
  const state = usePivotState();
  const returning = Boolean(state?.profile);
  return (
    <ButtonLink href={returning ? "/week" : "/onboarding"} className="h-12 px-6 text-base">
      {returning ? "Open my week" : "Build my week"} <ArrowRight />
    </ButtonLink>
  );
}
