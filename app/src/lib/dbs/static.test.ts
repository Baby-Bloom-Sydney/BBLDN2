// @vitest-environment node
/**
 * Unit 3c (BB-LDN-3c-061026) — static gates (brief "Static" tests).
 * 1. Exactly one application file under src writes `wwcc_verified: true` — 3d's Approve (`lib/actions/admin-dbs.ts`,
 *    D3). 0 after 3c (the regulator webhook is gone); 3d made it 1. Tests and UI mock fixtures are not writers.
 * 2. The five deleted routes / modules do not exist.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(__dirname, "../..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__fixtures__" ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const isNotWriter = (p: string) => /\.test\.tsx?$/.test(p) || p.endsWith("page-client-mocks.ts");

describe("3c static gates", () => {
  it("D3 exactly one code path writes wwcc_verified: true — adminVerifyWWCC", () => {
    const writers = files(SRC)
      .filter((p) => !isNotWriter(p))
      .filter((p) => /wwcc_verified\s*:\s*true/.test(readFileSync(p, "utf8")))
      .map((p) => p.slice(SRC.length + 1));
    expect(writers).toEqual(["lib/actions/admin-dbs.ts"]);
    const src = readFileSync(join(SRC, "lib/actions/admin-dbs.ts"), "utf8");
    expect(src.match(/wwcc_verified\s*:\s*true/g)).toHaveLength(1);
    const at = src.search(/wwcc_verified\s*:\s*true/);
    const owner = src.slice(0, at).lastIndexOf("export async function ");
    expect(src.slice(owner, owner + 45)).toContain("adminVerifyWWCC");
  });

  it("the deleted routes and modules do not exist", () => {
    for (const p of [
      "lib/ai/verify-wwcc.ts",
      "lib/ai/verify-wwcc-pdf.ts",
      "app/api/validate-wwcc-pdf",
      "app/api/webhooks/ocg-verification",
      "lib/verification/parse-ocg-email.ts",
    ]) {
      expect(existsSync(join(SRC, p)), p).toBe(false);
    }
  });
});
