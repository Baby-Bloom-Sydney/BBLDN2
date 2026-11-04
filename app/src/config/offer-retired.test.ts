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

/** A module specifier that resolves to `src/config/offer`, from anywhere in `src/`. */
const SPEC = String.raw`["'](?:@/config/offer|(?:\.{1,2}/)+(?:config/)?offer)(?:\.[cm]?[jt]sx?)?["']`;
/** `import { … } from` / `import type { … } from` / `import x, { … } from` / `export { … } from`. */
const NAMED = new RegExp(
  String.raw`(?:import|export)\s*(?:type\s*)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*${SPEC}`,
  "g",
);
/** Forms that reach every export at once: namespace, default, re-export-all, dynamic import, `vi.mock`, require. */
const WHOLE = new RegExp(
  String.raw`(?:import\s*\*\s*as\s+[\w$]+\s+from\s*|import\s+[\w$]+\s+from\s*|export\s*\*\s*from\s*|import\s*\(\s*|mock\s*\(\s*|require\s*\(\s*)${SPEC}`,
);

const specName = (spec: string): string =>
  spec
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")
    .trim()
    .replace(/^type\s+/, "")
    .split(/\s+as\s+/)[0];

/** Does this source text import `name` from the offer config, in any form? */
function importsName(source: string, name: Retired): boolean {
  if (WHOLE.test(source)) return true;
  return [...source.matchAll(NAMED)].some((m) => m[1].split(",").some((spec) => specName(spec) === name));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [full] : [];
  });
}

const THIS_FILE = path.relative(SRC, __filename).split(path.sep).join("/");

function importersOf(name: Retired): string[] {
  return sourceFiles(SRC)
    .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
    .filter((rel) => rel !== THIS_FILE)
    .filter((rel) => importsName(readFileSync(path.join(SRC, rel), "utf8"), name))
    .sort();
}

describe("importsName — the matcher catches every import form (brief 01 §9.6)", () => {
  it.each([
    ["plain", `import { G1 } from "@/config/offer";`],
    ["multi-line", `import {\n  G2,\n  G1,\n} from "@/config/offer";`],
    ["import type", `import type { G1 } from "@/config/offer";`],
    ["inline type", `import { G2, type G1 } from "@/config/offer";`],
    ["alias", `import { G1 as windowRule } from "@/config/offer";`],
    ["comment in braces", `import { G2, // note\n G1 } from "@/config/offer";`],
    ["deep relative", `import { G1 } from "../../config/offer";`],
    ["sibling", `import { G1 } from "./offer";`],
    ["extension", `import { G1 } from "@/config/offer.ts";`],
    ["default plus named", `import x, { G1 } from "@/config/offer";`],
    ["re-export", `export { G1 } from "@/config/offer";`],
    ["namespace", `import * as offer from "@/config/offer";`],
    ["dynamic", `const offer = await import("@/config/offer");`],
    ["vi.mock", `vi.mock("@/config/offer", () => ({}));`],
  ])("catches %s", (_label, source) => {
    expect(importsName(source, "G1")).toBe(true);
  });

  it.each([
    ["a G2-only import", `import { G2 } from "@/config/offer";`],
    ["a similar name", `import { G10 } from "@/config/offer";`],
    ["another config module", `import { G1 } from "@/config/prices";`],
    ["the name in a comment only", `// G1 was retired\nimport { G2 } from "@/config/offer";`],
  ])("ignores %s", (_label, source) => {
    expect(importsName(source, "G1")).toBe(false);
  });
});

describe("retired offer numbers — no new importer (brief 01 §0.4)", () => {
  it.each(RETIRED)("%s is imported only where it was on 2026-11-04", (name) => {
    expect(
      importersOf(name),
      `The importer set of ${name} changed. If a reader was removed, delete it from ALLOWED. ` +
        `If one was added: ${name} was retired on 2026-11-04 (OPEN §5d), so read FIRST_WEEK_OFF_BILL or G2 instead.`,
    ).toEqual([...ALLOWED[name]].sort());
  });
});
