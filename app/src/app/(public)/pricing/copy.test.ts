/**
 * Brief 12 (required, BAI 2026-11-04): matchmaking is free, the placement is not, so public copy says
 * "no matchmaking fees" and never "placement fee". The quick-match's "Free for families." stays (ADR-056).
 *
 * BB-wave1-041126, 2026-11-04.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = path.resolve(__dirname, "../../../..");
const read = (rel: string): string => readFileSync(path.join(APP, rel), "utf8");
/** JSX wraps text across lines; compare with whitespace collapsed. */
const flat = (text: string): string => text.replace(/\s+/g, " ");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("/pricing — no matchmaking fees (brief 12 §0.8, §0.9)", () => {
  const pricing = flat(read("src/app/(public)/pricing/page.tsx"));

  it("the checklist says no matchmaking fees", () => {
    expect(pricing).toContain("No subscription, no commission, no matchmaking fees");
  });

  it("the hero ends 'No matchmaking fees for families.'", () => {
    expect(pricing).toContain("No matchmaking fees for families.");
    expect(pricing).not.toContain("No fees for families");
  });

  it("no public or landing copy says 'placement fee'", () => {
    const hits = [...files(path.join(APP, "src/app/(public)")), ...files(path.join(APP, "src/components/landing"))]
      .filter((file) => /placement fee/i.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(APP, file));
    expect(hits).toEqual([]);
  });

  it("the home quick-match still says 'Free for families.' (ADR-056)", () => {
    expect(flat(read("src/components/landing/QuickMatch.tsx"))).toContain("Free for families.");
  });
});
