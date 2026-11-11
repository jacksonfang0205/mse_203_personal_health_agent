"use client";

import { useRouter } from "next/navigation";
import { startDemo } from "@/lib/demo";
import { usePivotState } from "@/lib/store";
import { useAccount } from "./AccountProvider";
import { ArrowRight } from "./icons";
import { Button, ButtonLink } from "./ui";

/** Landing CTA: sign in first when accounts are on, then setup, then the week. */
export function StartButton() {
  const state = usePivotState();
  const { enabled, user, demo, signIn } = useAccount();
  const router = useRouter();
  const returning = Boolean(state?.profile);
  if (enabled && user === null && !demo) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => signIn("/onboarding")} className="h-12 px-6 text-base">
          Sign in to start <ArrowRight />
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            startDemo();
            router.push("/week");
          }}
          className="h-12 px-6 text-base"
        >
          Try the demo
        </Button>
      </div>
    );
  }
  return (
    <ButtonLink href={returning ? "/week" : "/onboarding"} className="h-12 px-6 text-base">
      {returning ? "Open my week" : "Build my week"} <ArrowRight />
    </ButtonLink>
  );
}
