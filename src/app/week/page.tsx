import type { Metadata } from "next";
import { WeekView } from "@/components/week/WeekView";

export const metadata: Metadata = { title: "My week · Pivot" };

export default function WeekPage() {
  return <WeekView />;
}
