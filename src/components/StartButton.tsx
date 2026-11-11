"use client";

import { usePivotState } from "@/lib/store";
import { useAccount } from "./AccountProvider";
import { ArrowRight } from "./icons";
import { Button, ButtonLink } from "./ui";

/** Landing CTA: sign in first when accounts are on, then setup, then the week. */
export function StartButton() {
  const state = usePivotState();
  const { enabled, user, signIn } = useAccount();
  const returning = Boolean(state?.profile);
  if (enabled && user === null) {
    return (
      <Button onClick={() => signIn("/onboarding")} className="h-12 px-6 text-base">
        Sign in to start <ArrowRight />
      </Button>
    );
  }
  return (
    <ButtonLink href={returning ? "/week" : "/onboarding"} className="h-12 px-6 text-base">
      {returning ? "Open my week" : "Build my week"} <ArrowRight />
    </ButtonLink>
  );
}
