import type { Metadata } from "next";
import { PreferencesEditor } from "@/components/preferences/PreferencesEditor";

export const metadata: Metadata = { title: "Preferences · Pivot" };

export default function PreferencesPage() {
  return <PreferencesEditor />;
}
