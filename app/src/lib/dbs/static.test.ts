// @vitest-environment node
/**
 * Unit 3c (BB-LDN-3c-061026) — static gates (brief "Static" tests).
 * 1. No application file under src writes `wwcc_verified: true` — 0 after 3c (the OCG webhook is gone).
 *    3d changes the expectation to exactly 1 (its own Approve). Tests and UI mock fixtures are not writers.
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
  it("no file under src writes wwcc_verified: true", () => {
    const writers = files(SRC)
      .filter((p) => !isNotWriter(p))
      .filter((p) => /wwcc_verified\s*:\s*true/.test(readFileSync(p, "utf8")))
      .map((p) => p.slice(SRC.length + 1));
    expect(writers).toEqual([]);
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
