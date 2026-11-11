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
import type { CalendarPresetId } from "./calendar";
import type { BlockedTime, ChangeRecord, FitnessProfile, MemoryNote, WeeklyPlan, WorkoutExercise, WorkoutStatus } from "./schemas";
import { isAllDay } from "./memoryRules";
import { localNow } from "./time";

import { AppState } from "./appState";

export { AppState };

const EMPTY: AppState = {
  version: 1,
  profile: null,
  plan: null,
  history: [],
  calendarPreset: "student",
  blocked: [],
  notes: [],
  log: [],
  ticks: {},
};

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

/** Sets in a prescription; timed blocks count as one. */
export function setCount(we: WorkoutExercise): number {
  return we.minutes ? 1 : Math.max(1, we.sets ?? 1);
}

function withStatus(s: AppState, workoutId: string, status: WorkoutStatus): AppState {
  if (!s.plan) return s;
  const w = s.plan.workouts.find((x) => x.id === workoutId);
  // The log outlives the weekly plan, so later weeks can learn from this one.
  const log = s.log.filter((e) => e.workoutId !== workoutId);
  if (w && status !== "planned") {
    log.unshift({
      workoutId,
      date: w.date,
      start: w.start,
      durationMin: w.durationMin,
      category: w.category,
      status,
      at: new Date().toISOString(),
    });
  }
  return {
    ...s,
    plan: { ...s.plan, workouts: s.plan.workouts.map((x) => (x.id === workoutId ? { ...x, status } : x)) },
    log: log.slice(0, 300),
  };
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
    update((s) => ({
      ...s,
      plan,
      // Keep ticks only for workouts that are still in the plan.
      ticks: Object.fromEntries(Object.entries(s.ticks).filter(([id]) => plan.workouts.some((w) => w.id === id))),
    }));
  },
  setWorkoutStatus(workoutId: string, status: WorkoutStatus) {
    update((s) => {
      // An explicit status resets the per-set ticks; a completed workout reads as every set done.
      const ticks = { ...s.ticks };
      delete ticks[workoutId];
      return withStatus({ ...s, ticks }, workoutId, status);
    });
  },
  /**
   * Tick sets off on the Today view. Finishing every set completes the
   * workout; unticking a set of a completed workout reopens it.
   */
  setSetsDone(workoutId: string, exerciseIndex: number, done: number) {
    update((s) => {
      const w = s.plan?.workouts.find((x) => x.id === workoutId);
      if (!w) return s;
      const totals = w.exercises.map(setCount);
      const row = totals.map((t, i) => Math.min(t, s.ticks[workoutId]?.[i] ?? (w.status === "completed" ? t : 0)));
      row[exerciseIndex] = Math.max(0, Math.min(totals[exerciseIndex] ?? 0, done));
      const next = { ...s, ticks: { ...s.ticks, [workoutId]: row } };
      const allDone = row.every((n, i) => n >= totals[i]);
      if (allDone && w.status !== "completed") return withStatus(next, workoutId, "completed");
      if (!allDone && w.status === "completed") return withStatus(next, workoutId, "planned");
      return next;
    });
  },
  recordChange(record: ChangeRecord) {
    update((s) => ({ ...s, history: [record, ...s.history].slice(0, 100) }));
  },
  setCalendarPreset(calendarPreset: CalendarPresetId) {
    update((s) => ({ ...s, calendarPreset }));
  },
  addBlocked(items: BlockedTime[]) {
    update((s) => {
      // A weekday that's now unavailable all day stops being a "day that works" (one day always stays).
      const out = new Set(items.filter((b) => !b.date && isAllDay(b)).flatMap((b) => b.days));
      const days = s.profile?.preferredDays.filter((d) => !out.has(d)) ?? [];
      const profile = s.profile && out.size && days.length ? { ...s.profile, preferredDays: days } : s.profile;
      return { ...s, profile, blocked: [...s.blocked, ...items] };
    });
  },
  removeBlocked(id: string) {
    update((s) => ({ ...s, blocked: s.blocked.filter((b) => b.id !== id) }));
  },
  addNotes(items: MemoryNote[]) {
    update((s) => ({ ...s, notes: [...s.notes, ...items].slice(-50) }));
  },
  removeNote(id: string) {
    update((s) => ({ ...s, notes: s.notes.filter((n) => n.id !== id) }));
  },
  /** Replace everything, e.g. with the copy saved to the user's account. */
  replaceAll(state: AppState) {
    update(() => state);
  },
  /** Called after every change; returns an unsubscribe function. Used to sync to the account. */
  onChange(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
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
