import { describe, expect, it } from "vitest";
import { generateMockWeek } from "@/lib/planner/generate";
import { avoidTagsFromText, DEFAULT_DRAFT, finalizeDraft, goalsFromText } from "./sections";

describe("setup answers", () => {
  it("turns negative phrases about activities into enforced restrictions", () => {
    expect(avoidTagsFromText("Tweaked my shoulder, so nothing overhead this week").sort()).toEqual(["overhead"]);
    expect(avoidTagsFromText("no running, my knees hurt when I jump").sort()).toEqual(["high_impact", "running"]);
    expect(avoidTagsFromText("Floors are being refinished, can't do floor work")).toEqual(["floor_work"]);
    expect(avoidTagsFromText("I love running and lifting")).toEqual([]);
  });

  it("saves restrictions from the text box and keeps ones chosen earlier", () => {
    const p = finalizeDraft(
      { ...DEFAULT_DRAFT, goals: ["strength"], workoutTypes: ["gym"], preferredDays: ["mon"], preferredTimes: ["evening"], avoidTags: ["heavy_barbell"], limitations: "no jumping please" },
      "2026-11-11T00:00:00Z",
    );
    expect(p.success && p.data.avoidTags.sort()).toEqual(["heavy_barbell", "high_impact"]);
  });

  it("offers Lose fat, from the picker or the user's own words, and plans cardio plus strength for it", () => {
    expect(goalsFromText("I want to lose fat before summer")).toContain("fat_loss");
    const p = finalizeDraft(
      { ...DEFAULT_DRAFT, goals: ["fat_loss"], workoutTypes: ["gym", "running"], equipment: ["dumbbells"], frequencyPerWeek: 3, preferredDays: ["mon", "wed", "fri"], preferredTimes: ["evening"] },
      "2026-11-11T00:00:00Z",
    );
    expect(p.success).toBe(true);
    if (!p.success) return;
    expect(p.data.experience).toBe("beginner"); // not asked in setup; the safe default
    const week = generateMockWeek({ profile: p.data, weekStart: "2026-11-09", busy: [], createdAt: "x" });
    const cats = new Set(week.workouts.map((w) => w.category));
    expect(cats.has("cardio") && cats.has("strength")).toBe(true);
  });
});
