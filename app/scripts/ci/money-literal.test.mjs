/**
 * Money literal — ADR-092's "never literal" as a check, not a paragraph.
 *
 * Every London amount lives in `src/config/` (`prices.ts`, `offer.ts`; LDN2
 * Stage 4 unit 4-0, P-18). This spec fails on any pound amount, pence-shaped
 * number or `_pence` assignment written anywhere else in `src/`. Test files
 * are exempt: they pin values on purpose.
 *
 * **Unpinned by 4g.** What legitimately remains is listed in
 * `money-literal.allow.json` (same shape as the sweep's allow file: file ·
 * match · owner · note): the payout surface hidden behind `PAYOUTS_ENABLED`
 * (P-23), the demo pages Stage 5 gates, dead `Paywall.tsx`, and figures that
 * are not Baby Bloom prices (nanny wages, the DBS Update Service fee). The spec
 * fails on any hit no entry silences **and** on any entry that silences
 * nothing (ratchet, like the sweep: the list may only shrink). `match` is the
 * **whole trimmed line**, compared for equality — stricter than the sweep's
 * substring, so an entry can never silence a new literal written beside it.
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

const ALLOW_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "money-literal.allow.json");

/** The sweep's stage owners (`london-sweep.mjs`, 04-sequence §4) — every allow entry names one. */
const OWNERS = ["identity", "money", "legal", "removals", "matching", "hardening", "cleanup"];

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
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const match = PATTERNS.find(({ re }) => re.test(line));
        if (match) found.push({ file: `app/src/${rel}`, line: i + 1, text: line.trim(), rule: match.name });
      });
  }
  return found;
}

const loadAllow = () => JSON.parse(readFileSync(ALLOW_FILE, "utf8"));

/** Pure: hits + allow list in, the un-allowed hits and the stale entries out (every matching entry counts as used). */
export function evaluate(found, allow) {
  const used = new Set();
  const unallowed = found.filter((hit) => {
    let silenced = false;
    allow.forEach((entry, index) => {
      if (entry.file === hit.file && hit.text === entry.match) {
        used.add(index);
        silenced = true;
      }
    });
    return !silenced;
  });
  const stale = allow.filter((_, index) => !used.has(index));
  return { unallowed, stale };
}

const show = (hit) => `${hit.file}:${hit.line} — ${hit.rule}`;

describe("money literal", () => {
  it("writes no money literal in src/ outside config/, tests and the owned allow list", () => {
    const { unallowed } = evaluate(hits(), loadAllow());
    expect(unallowed.map(show)).toEqual([]);
  });

  it("has no stale allow entry — an entry whose line is gone fails (the list may only shrink)", () => {
    const { stale } = evaluate(hits(), loadAllow());
    expect(stale).toEqual([]);
  });

  it("every allow entry is well formed and owned", () => {
    const allow = loadAllow();
    expect(Array.isArray(allow)).toBe(true);
    for (const entry of allow) {
      expect(Object.keys(entry).sort()).toEqual(["file", "match", "note", "owner"]);
      expect(entry.file).toMatch(/^app\/src\//);
      expect(typeof entry.match === "string" && entry.match.length > 0).toBe(true);
      expect(OWNERS).toContain(entry.owner);
      expect(typeof entry.note === "string" && entry.note.length > 0).toBe(true);
    }
  });

  it("the ratchet works both ways on a synthetic tree", () => {
    const found = [{ file: "app/src/a.tsx", line: 1, text: "<p>£5</p>", rule: "a pound amount" }];
    expect(evaluate(found, []).unallowed).toHaveLength(1);
    const entry = { file: "app/src/a.tsx", match: "<p>£5</p>", owner: "money", note: "x" };
    expect(evaluate(found, [entry])).toEqual({ unallowed: [], stale: [] });
    expect(evaluate([], [entry]).stale).toEqual([entry]);
    // A substring of the line silences nothing — the whole line must match.
    expect(evaluate(found, [{ ...entry, match: "£5" }]).unallowed).toHaveLength(1);
    // Another file's entry silences nothing here.
    expect(evaluate(found, [{ ...entry, file: "app/src/b.tsx" }]).unallowed).toHaveLength(1);
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
    // 4g: the unpinned spec must still find what it allows — a tree it cannot read would leave every entry stale.
    expect(hits().length).toBeGreaterThan(0);
    // A walk that half-skips the tree would still clear 500; these must be in it.
    expect(rels).toContain("app/parent/subscribe/SubscribeClient.tsx");
    expect(rels).toContain("lib/constants.ts");
  });
});
