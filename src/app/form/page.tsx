import type { Metadata } from "next";
import { FormCoach } from "@/components/form/FormCoach";

export const metadata: Metadata = { title: "Form correction · Pivot" };

export default function FormPage() {
  return <FormCoach />;
}
