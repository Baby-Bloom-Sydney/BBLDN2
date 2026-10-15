/**
 * Money literal — ADR-092's "never literal" as a check, not a paragraph.
 *
 * Every London amount lives in `src/config/` (`prices.ts`, `offer.ts`; LDN2
 * Stage 4 unit 4-0, P-18). This spec fails on any pound amount, pence-shaped
 * number or `_pence` assignment written anywhere else in `src/`. Test files
 * are exempt: they pin values on purpose.
 *
 * **Red on `main` by design.** Sydney's prices, ladders and copy still carry
 * literals; unit 4g removes them. Until then the main assertion is committed
 * as `it.fails` (the suite stays green), and a ceiling pins the count measured
 * at 4-0 so a NEW literal still fails today. 4g flips `it.fails` to `it` and
 * deletes the ceiling. Not a CI required check (brief 4-0).
 *
 * Lives in `scripts/ci/` beside the sweep, which skips this directory, so the
 * spellings below are not themselves gate hits (`LEDGER/2-0.md` §8 lesson 3).
 * Precedent: 2k's one-clock spec.
 *
 * BB-LDN-4-0-141026, 2026-10-14.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");

/** Line count measured on `main` @ bca79e7 (ledger 4-0 §4): 35. 4b re-valued the subscribe page: 32. May only fall. */
const CEILING_AT_4_0 = 32;

export const PATTERNS = [
  { name: "a pound amount", re: /£\d/ },
  { name: "a pence-shaped number literal", re: /\d+_00\b/ },
  { name: "a `_pence` field set to a number", re: /_pence\s*[:=]\s*\d/ },
  // Added at review (4-0): the config's own spelling, `feePence: 150_000`, which none of the three
  // brief patterns can see — so an amount copied out of config/ would pass. Matches 0 lines on main.
  { name: "a `*Pence` field set to a number", re: /[a-z]Pence\s*[:=]\s*\d/ },
];

const isTestFile = (name) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(name);

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return path.relative(SRC, full) === "config" ? [] : sourceFiles(full);
    }
    if (!/\.[cm]?[jt]sx?$/.test(entry.name) || isTestFile(entry.name)) return [];
    return [full];
  });
}

function hits() {
  const found = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file);
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const match = PATTERNS.find(({ re }) => re.test(line));
        if (match) found.push(`src/${rel}:${i + 1} — ${match.name}`);
      });
  }
  return found;
}

describe("money literal", () => {
  it.fails("writes no money literal in src/ outside config/ and tests (4g unpins)", () => {
    expect(hits()).toEqual([]);
  });

  it("adds no new literal while the rule is pinned — the count may only fall", () => {
    expect(hits().length).toBeLessThanOrEqual(CEILING_AT_4_0);
  });

  it("can actually see a literal — the detector is not vacuous", () => {
    const spellings = [
      '<p className="price">£1,500</p>',
      "const fee = 1500_00;",
      "{ fee_pence: 150000 }",
      "row.deposit_pence = 15000",
      "const price = { feePence: 150_000 };",
    ];
    for (const spelling of spellings) {
      expect(
        PATTERNS.some(({ re }) => re.test(spelling)),
        `no pattern matched: ${spelling}`,
      ).toBe(true);
    }
  });

  it("exempts config/ and test files, nothing else", () => {
    const rels = sourceFiles(SRC).map((f) => path.relative(SRC, f));
    expect(rels.some((r) => r.startsWith(`config${path.sep}`))).toBe(false);
    expect(rels.some((r) => isTestFile(path.basename(r)))).toBe(false);
  });

  it("scans the real tree, not an empty directory", () => {
    const rels = sourceFiles(SRC).map((f) => path.relative(SRC, f).split(path.sep).join("/"));
    expect(rels.length).toBeGreaterThan(500);
    // A walk that half-skips the tree would still clear 500; these must be in it.
    expect(rels).toContain("app/parent/subscribe/SubscribeClient.tsx");
    expect(rels).toContain("lib/constants.ts");
  });
});
