/** Shared loader for labeled clips in data/form/clips/<movement>/*.json. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { LabeledClip } from "../../src/lib/form/golden";

export const CLIPS_DIR = join(process.cwd(), "data", "form", "clips");

export function loadClips(dir = CLIPS_DIR): LabeledClip[] {
  const out: LabeledClip[] = [];
  const walk = (d: string) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".json")) {
        const parsed = LabeledClip.safeParse(JSON.parse(readFileSync(p, "utf8")));
        if (!parsed.success) throw new Error(`${p}: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
        out.push(parsed.data);
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
