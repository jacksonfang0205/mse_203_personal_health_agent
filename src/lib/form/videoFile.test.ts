import { describe, expect, it } from "vitest";
import { checkVideoFile, extensionOf } from "./videoFile";

const MB = 1024 * 1024;
const file = (name: string, type: string, size = 20 * MB) => ({ name, type, size });

describe("checkVideoFile", () => {
  it("accepts an iPhone .mov, including when the browser leaves the type empty", () => {
    expect(checkVideoFile(file("IMG_4021.MOV", "video/quicktime")).ok).toBe(true);
    expect(checkVideoFile(file("IMG_4021.MOV", "")).ok).toBe(true);
  });

  it("accepts .mp4, .m4v and .webm", () => {
    for (const [name, type] of [["squat.mp4", "video/mp4"], ["a.m4v", ""], ["b.webm", "video/webm"]]) expect(checkVideoFile(file(name, type)).ok).toBe(true);
  });

  it("flags a photo before analysis, with a hint for Live Photos", () => {
    const r = checkVideoFile(file("IMG_4021.HEIC", "image/heic"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/photo[^]*\.heic[^]*Live Photo/);
  });

  it("flags other non-video files by their extension", () => {
    const r = checkVideoFile(file("workout.pdf", "application/pdf"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(".pdf");
  });

  it("flags empty and oversized files", () => {
    expect(checkVideoFile(file("a.mov", "video/quicktime", 0)).ok).toBe(false);
    expect(checkVideoFile(file("a.mov", "video/quicktime", 3 * 1024 * MB)).ok).toBe(false);
  });
});

describe("extensionOf", () => {
  it("lower-cases the last extension", () => {
    expect(extensionOf("IMG.final.MOV")).toBe("mov");
    expect(extensionOf("noext")).toBe("");
  });
});
