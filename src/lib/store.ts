"use client";

/**
 * Single-user persistence for the prototype.
 *
 * State lives in localStorage behind a small repository interface so it can
 * later move server-side (e.g. a hosted KV/Postgres store) without touching
 * components. Everything read back is re-validated with Zod; corrupt or
 * outdated data is discarded rather than crashing the app.
 */
import { useSyncExternalStore } from "react";
import { z } from "zod";
import { CALENDAR_PRESET_IDS, type CalendarPresetId } from "./calendar";
import { ChangeRecord, FitnessProfile, WeeklyPlan, type WorkoutStatus } from "./schemas";
import { localNow } from "./time";

const AppState = z.object({
  version: z.literal(1),
  profile: FitnessProfile.nullable(),
  plan: WeeklyPlan.nullable(),
  history: z.array(ChangeRecord),
  calendarPreset: z.enum(CALENDAR_PRESET_IDS as [CalendarPresetId, ...CalendarPresetId[]]),
});
export type AppState = z.infer<typeof AppState>;

const EMPTY: AppState = { version: 1, profile: null, plan: null, history: [], calendarPreset: "student" };

export interface PivotRepository {
  load(): AppState;
  save(state: AppState): void;
}

const STORAGE_KEY = "pivot:v1:state";

export const localRepository: PivotRepository = {
  load() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return EMPTY;
      const parsed = AppState.safeParse(JSON.parse(raw));
      if (!parsed.success) console.warn("Pivot: stored state failed validation; starting fresh.", parsed.error.issues);
      return parsed.success ? parsed.data : EMPTY;
    } catch {
      return EMPTY;
    }
  },
  save(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage may be full or blocked (private mode); the session still works in memory.
    }
  },
};

let repo: PivotRepository = localRepository;
let cache: AppState | null = null;
const listeners = new Set<() => void>();

function snapshot(): AppState {
  if (typeof window === "undefined") return EMPTY;
  if (!cache) cache = repo.load();
  return cache;
}

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cache = null;
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Returns null during server render and hydration, then the stored state. */
export function usePivotState(): AppState | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

function update(fn: (s: AppState) => AppState) {
  cache = AppState.parse(fn(snapshot()));
  repo.save(cache);
  emit();
}

export const pivot = {
  get: snapshot,
  setRepository(r: PivotRepository) {
    repo = r;
    cache = null;
    emit();
  },
  saveProfile(profile: FitnessProfile) {
    update((s) => ({ ...s, profile }));
  },
  setPlan(plan: WeeklyPlan) {
    update((s) => ({ ...s, plan }));
  },
  setWorkoutStatus(workoutId: string, status: WorkoutStatus) {
    update((s) =>
      s.plan
        ? { ...s, plan: { ...s.plan, workouts: s.plan.workouts.map((w) => (w.id === workoutId ? { ...w, status } : w)) } }
        : s,
    );
  },
  recordChange(record: ChangeRecord) {
    update((s) => ({ ...s, history: [record, ...s.history].slice(0, 100) }));
  },
  setCalendarPreset(calendarPreset: CalendarPresetId) {
    update((s) => ({ ...s, calendarPreset }));
  },
  reset() {
    update(() => EMPTY);
  },
};

// ---------- Client clock ----------

let nowKey = "";
let nowValue: ReturnType<typeof localNow> | null = null;

function readNow() {
  const n = localNow(new Date());
  const key = `${n.date} ${n.time}`;
  if (key !== nowKey) {
    nowKey = key;
    nowValue = n;
  }
  return nowValue!;
}

function subscribeNow(cb: () => void) {
  const id = window.setInterval(cb, 30_000);
  return () => window.clearInterval(id);
}

/** Current local date/time, refreshed every 30 s. Null on the server. */
export function useNow() {
  return useSyncExternalStore(subscribeNow, readNow, () => null);
}
