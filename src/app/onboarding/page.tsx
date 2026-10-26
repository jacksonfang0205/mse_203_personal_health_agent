import type { Metadata } from "next";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";

export const metadata: Metadata = { title: "Get started · Pivot" };

export default function OnboardingPage() {
  return <OnboardingFlow />;
}
