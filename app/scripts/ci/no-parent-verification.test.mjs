// no-parent-verification.test.mjs — LDN2 unit 3h gate (D-7).
//
// London parents are never asked to verify. Unit 3h deleted the parent identity verification surface (pages,
// pipeline, admin tab, Katie branch, legal AGR-03, the driver's-licence verifier); this gate keeps it deleted. It
// scans every source file under `app/src` and fails on any reference to the removed surface. It lives in
// `scripts/ci/` (outside `src/`) so its own pattern list is never a hit.
//
// The gate is driven, not trusted: the first case proves each pattern fires on a fixture line.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..", "..");
const SRC = join(APP, "src");

/** The removed surface. Case-sensitive except where noted, as the brief's grep proof. */
export const PATTERNS = [
  { name: "parent_verif", re: /parent_verif/ },
  { name: "parent-verif", re: /parent-verif/ },
  { name: "parentVerified", re: /parentVerified/ },
  { name: "AGR03", re: /AGR03/ },
  { name: "AGR-03", re: /AGR-03/ },
  { name: "verify-drivers-license", re: /verify-drivers-license/ },
  // Component/prop names of the removed surface (ParentVerificationTab, parentVerificationStats, …).
  { name: "ParentVerification (any case)", re: /parentverification/i },
  { name: "ParentIDCheck", re: /ParentIDCheck/ },
];

const SOURCE = /\.(ts|tsx|js|jsx|mjs|json|css|md|sql)$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (SOURCE.test(entry)) out.push(p);
  }
  return out;
}

function hits(text) {
  return PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

describe("no-parent-verification gate (LDN2 3h)", () => {
  it("fires on every pattern (driven, not trusted)", () => {
    const fixtures = [
      '.from("parent_verifications")',
      'bucket: "parent-verifications"',
      "parentVerified={true}",
      "AGR03_CHECKPOINTS",
      '"AGR-03"',
      'import x from "@/lib/ai/verify-drivers-license"',
      "<ParentVerificationTab />",
      "<ParentIDCheckModal />",
    ];
    for (const line of fixtures) expect(hits(line), line).not.toHaveLength(0);
    expect(hits('href="/nanny/verification"')).toHaveLength(0);
  });

  it("finds no reference to parent_verif, parent-verif, parentVerified, AGR03, AGR-03 or verify-drivers-license under app/src when 3h is applied", () => {
    const found = [];
    for (const file of walk(SRC)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const h = hits(line);
        if (h.length) found.push(`${relative(APP, file)}:${i + 1} [${h.join(", ")}]`);
      });
    }
    expect(found).toEqual([]);
  });
});
