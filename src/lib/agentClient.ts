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

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data as T;
}

export const requestPlan = (req: AgentRequest) => post<PlanResult>("/api/plan", req);
export const requestLifeHappens = (req: AgentRequest & { message: string }) =>
  post<LifeHappensResult>("/api/life-happens", req);
