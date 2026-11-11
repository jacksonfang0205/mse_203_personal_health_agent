import type { Metadata } from "next";
import { SignInForm } from "@/components/SignInForm";

export const metadata: Metadata = { title: "Sign in · Pivot" };

export default function SignInPage() {
  return <SignInForm />;
}
