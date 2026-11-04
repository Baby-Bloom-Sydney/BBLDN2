/**
 * The server-only half of src/lib/cohorts (security review L5): no "use client" file may import it — those modules
 * write any family's place with the service role. The client-safe half (rules, dates, copy, constants, types) may
 * be imported anywhere. Static check over src/.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const SERVER_ONLY = /from\s+["']@\/lib\/cohorts\/(places|board|read|db|links|refund-hook)["']/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : files(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

describe("src/lib/cohorts' server-only modules", () => {
  it("are never imported by a client component", () => {
    const offenders = files(SRC).filter((f) => {
      const text = readFileSync(f, "utf8");
      return /^\s*["']use client["']/.test(text) && SERVER_ONLY.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("are not \"use server\" files (every async export would be callable)", () => {
    for (const name of ["places", "board", "read", "db", "links", "refund-hook"]) {
      const text = readFileSync(path.join(SRC, "lib/cohorts", `${name}.ts`), "utf8");
      expect(text).not.toMatch(/^\s*["']use server["']/m);
    }
  });
});
