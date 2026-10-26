"use client";

/**
 * Local timing instrumentation for user studies (Metric 2: planning efficiency).
 *
 * Events stay in this browser's localStorage until a facilitator exports
 * them from the Preferences page. Nothing is sent anywhere.
 */

export type TelemetryEventName =
  | "onboarding_started"
  | "onboarding_step_completed"
  | "onboarding_completed"
  | "plan_generated"
  | "preferences_saved"
  | "workout_status_changed"
  | "life_happens_opened"
  | "life_happens_submitted"
  | "alternative_accepted"
  | "alternatives_rejected";

export interface TelemetryEvent {
  name: TelemetryEventName;
  at: string;
  sessionId: string;
  props: Record<string, string | number | boolean | null>;
}

const KEY = "pivot:v1:events";
const SESSION_KEY = "pivot:v1:session";
const MAX_EVENTS = 1000;

function sessionId(): string {
  try {
    let id = window.sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

export function getEvents(): TelemetryEvent[] {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function track(name: TelemetryEventName, props: TelemetryEvent["props"] = {}) {
  try {
    const events = getEvents();
    events.push({ name, at: new Date().toISOString(), sessionId: sessionId(), props });
    window.localStorage.setItem(KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // Telemetry must never break the product.
  }
}

export function clearEvents() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {}
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
