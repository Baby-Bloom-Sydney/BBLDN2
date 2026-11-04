/**
 * The September offer numbers retired on 2026-11-04 (OPEN §5d) stay readable only where they are read
 * today. 07 and 08 keep these readers on their flag-off paths (P-23, hide not delete), so this list
 * never grows. The post-switch-on clean-up deletes the names, and this test with them.
 *
 * New code reads `FIRST_WEEK_OFF_BILL` and `G2` instead (brief 01 §0.4, §9.6).
 *
 * BB-wave1-041126, 2026-11-04.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");

const RETIRED = ["FIRST_WEEK_DISCOUNT_CAP", "G1", "G4"] as const;
type Retired = (typeof RETIRED)[number];

/** Today's importers, by file under `src/`, measured at `135b1e0`. */
const ALLOWED: Readonly<Record<Retired, readonly string[]>> = {
  FIRST_WEEK_DISCOUNT_CAP: [
    "config/offer.test.ts",
    "lib/actions/admin/dfy.test.ts",
    "lib/payments/dfy-access.test.ts",
    "lib/payments/dfy-access.ts",
  ],
  G1: [
    "app/admin/guarantees/GuaranteesClient.tsx",
    "app/admin/guarantees/rules.test.ts",
    "app/admin/guarantees/rules.ts",
    "config/offer.test.ts",
  ],
  G4: [
    "app/admin/guarantees/actions.test.ts",
    "app/admin/guarantees/rules.test.ts",
    "app/admin/guarantees/rules.ts",
    "config/offer.test.ts",
  ],
};

const IMPORT_FROM_OFFER = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'](?:@\/config\/offer|\.\/offer|\.\.\/config\/offer)["']/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [full] : [];
  });
}

export function importersOf(name: Retired, files: readonly string[] = sourceFiles(SRC)): string[] {
  return files
    .filter((file) =>
      [...readFileSync(file, "utf8").matchAll(IMPORT_FROM_OFFER)].some((m) =>
        m[1].split(",").some((spec) => spec.trim().split(/\s+as\s+/)[0] === name),
      ),
    )
    .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
    .sort();
}

describe("retired offer numbers — no new importer (brief 01 §0.4)", () => {
  it.each(RETIRED)("%s is imported only where it was on 2026-11-04", (name) => {
    expect(
      importersOf(name),
      `${name} was retired on 2026-11-04 (OPEN §5d). Read FIRST_WEEK_OFF_BILL or G2 instead.`,
    ).toEqual([...ALLOWED[name]].sort());
  });
});
