/**
 * Reviewed sets, kept in this browser so the coach can see load changes and
 * recurring faults next time. Keypoints and videos are never stored.
 */
import { z } from "zod";
import { FormSessionSummary } from "./schemas";

const KEY = "pivot.formHistory.v1";

export function loadFormHistory(): FormSessionSummary[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = z.array(FormSessionSummary).safeParse(raw ? JSON.parse(raw) : []);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function saveFormSession(s: FormSessionSummary) {
  try {
    const next = [s, ...loadFormHistory()].slice(0, 30);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the coach just won't have history next time.
  }
}

/** Pull a load and an RPE out of a free-text note like "24 kg, felt like RPE 8". */
export function parseSetNote(note: string): { loadKg?: number; rpe?: number } {
  const out: { loadKg?: number; rpe?: number } = {};
  const load = note.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|kilos?|lb|lbs|pounds?)\b/i);
  if (load) {
    const n = parseFloat(load[1]);
    out.loadKg = /^(lb|lbs|pound)/i.test(load[2]) ? Math.round(n * 0.4536 * 10) / 10 : n;
    if (out.loadKg > 500) delete out.loadKg;
  }
  const rpe = note.match(/rpe\s*(\d+(?:\.\d)?)/i) ?? note.match(/\b(\d+(?:\.\d)?)\s*(?:\/|out of)\s*10\b/i);
  if (rpe) {
    const n = parseFloat(rpe[1]);
    if (n >= 1 && n <= 10) out.rpe = n;
  }
  return out;
}
