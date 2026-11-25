import type { Metadata } from "next";
import { RoutineEditor } from "@/components/routine/RoutineEditor";

export const metadata: Metadata = { title: "Your routine · Pivot" };

export default function RoutinePage() {
  return <RoutineEditor />;
}
