"use client";

/**
 * Browser side of the agent routes. The server stores nothing, so each request
 * carries a snapshot of the user's profile, plan, and memory.
 */
import { useSyncExternalStore } from "react";
import type { AgentRequest } from "./agent/context";
import type { LifeHappensResult } from "./agent/lifeHappens";
import type { PlanResult } from "./agent/plan";
import type { ClockTime, IsoDate } from "./schemas";
import type { AppState } from "./store";

export interface AiStatus {
  ai: boolean;
  model: string | null;
  /** Google sign-in and the database are configured. */
  accounts?: boolean;
}

let status: AiStatus | null = null;
let pending: Promise<void> | null = null;

function subscribe(cb: () => void) {
  pending ??= fetch("/api/status")
    .then((r) => r.json())
    .then((s: AiStatus) => {
      status = s;
    })
    .catch(() => {
      status = { ai: false, model: null };
    });
  let live = true;
  pending.then(() => live && cb());
  return () => {
    live = false;
  };
}

/** Null until the server has answered. */
export function useAiStatus(): AiStatus | null {
  return useSyncExternalStore(subscribe, () => status, () => null);
}

export function agentSnapshot(state: AppState, now: { date: IsoDate; time: ClockTime }): AgentRequest {
  if (!state.profile) throw new Error("No profile yet.");
  return {
    profile: state.profile,
    plan: state.plan,
    history: state.history,
    blocked: state.blocked,
    notes: state.notes,
    log: state.log,
    calendarPreset: state.calendarPreset,
    now,
  };
}

/** Longest we wait for the AI before falling back, so the UI never spins forever. Just under the routes' maxDuration. */
const TIMEOUT_MS = 100_000;

async function post<T>(path: string, body: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new Error((e as Error).name === "TimeoutError" ? "took too long" : "couldn't reach the server");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data as T;
}

/** Planning is interactive, so it gives up sooner and the caller falls back to a quick plan. */
export const PLAN_TIMEOUT_MS = 30_000;
export const requestPlan = (req: AgentRequest) => post<PlanResult>("/api/plan", req, PLAN_TIMEOUT_MS);
export const requestLifeHappens = (req: AgentRequest & { message: string }) =>
  post<LifeHappensResult>("/api/life-happens", req);
