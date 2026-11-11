"use client";

/**
 * Demo mode: a ready-made profile and week, kept in this browser only, so
 * anyone (e.g. the teaching team) can try every feature without signing in.
 * Nothing in demo mode is saved to an account: database sync runs only for
 * signed-in users, and signing in leaves demo mode.
 */
import { useSyncExternalStore } from "react";
import type { FitnessProfile } from "./schemas";
import { buildSamplePlan } from "./session";
import { pivot } from "./store";
import { localNow } from "./time";

const KEY = "pivot:demo";
const EVENT = "pivot:demo-change";

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function write(on: boolean) {
  try {
    if (on) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    // storage blocked: demo still works for this page load
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Whether this browser is in demo mode. False during server render. */
export function useDemo(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

export const DEMO_PROFILE: Omit<FitnessProfile, "updatedAt"> = {
  version: 1,
  name: "Alex",
  goals: ["strength", "general_fitness"],
  goalNotes: "Get stronger and keep up some cardio around classes.",
  targetMuscles: [],
  experience: "intermediate",
  workoutTypes: ["gym", "running"],
  equipment: ["dumbbells", "kettlebell", "barbell", "bench", "squat_rack", "cable_machine", "pull_up_bar", "yoga_mat", "treadmill", "stationary_bike", "rower"],
  sessionMinutes: 45,
  frequencyPerWeek: 3,
  preferredDays: ["mon", "wed", "fri"],
  preferredTimes: ["morning", "evening"],
  avoidTags: [],
  avoidExerciseIds: [],
  avoidNotes: "",
  limitations: "",
};

/** Load the sample profile and a fresh week into this browser and turn demo mode on. */
export function startDemo() {
  const at = new Date();
  const now = localNow(at);
  const profile: FitnessProfile = { ...DEMO_PROFILE, updatedAt: at.toISOString() };
  const plan = buildSamplePlan({ profile, preset: "student", now, createdAt: at.toISOString() });
  pivot.replaceAll({ version: 1, profile, plan, history: [], calendarPreset: "student", blocked: [], notes: [], log: [], ticks: {} });
  write(true);
}

/** Leave demo mode and clear the sample data from this browser. */
export function endDemo() {
  write(false);
  pivot.reset();
}

/** Leave demo mode without touching data (used right before signing in, which loads the account's own data). */
export function clearDemoFlag() {
  write(false);
}
