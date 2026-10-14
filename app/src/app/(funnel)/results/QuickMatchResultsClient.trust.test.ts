// @vitest-environment node
/** 3g (BB-LDN-3g-141026), orchestrator ruling 2026-10-14: the quick-match results trust row reads "Enhanced DBS checked". */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("QuickMatchResultsClient trust row", () => {
  it("says \"Enhanced DBS checked\"", () => {
    const src = readFileSync(join(__dirname, "QuickMatchResultsClient.tsx"), "utf8").replace(/\s+/g, " ");
    expect(src).toContain('<ShieldCheck className="w-3.5 h-3.5 text-green-500" /> Enhanced DBS checked </span>');
  });
});
