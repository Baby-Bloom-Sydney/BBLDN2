// @vitest-environment node
/**
 * 3g (BB-LDN-3g-141026), orchestrator rulings 2026-10-14: every trust row (quick-match results, matchmaking results,
 * landing QuickMatch) reads "Enhanced DBS checked".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(__dirname, "../../..");
const flat = (rel: string) => readFileSync(join(SRC, rel), "utf8").replace(/\s+/g, " ");

describe("trust rows", () => {
  it.each([
    ["app/(funnel)/results/QuickMatchResultsClient.tsx", '<ShieldCheck className="w-3.5 h-3.5 text-green-500" /> Enhanced DBS checked </span>'],
    ["app/(funnel)/matchmaking/results/MatchResultsClient.tsx", '<ShieldCheck className="w-3.5 h-3.5 text-green-500" /> Enhanced DBS checked </span>'],
    ["components/landing/QuickMatch.tsx", "<span>Enhanced DBS checked</span>"],
  ])("%s says \"Enhanced DBS checked\"", (rel, snippet) => {
    expect(flat(rel)).toContain(snippet);
  });
});
