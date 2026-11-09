/**
 * The verification sync is a server-only helper: it lives in its own module, not in the `"use server"` verification
 * actions module.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("the verification actions' surface", () => {
  it("does not export the sync", () => {
    const source = readFileSync(resolve(__dirname, "verification.ts"), "utf8");
    expect(source).not.toMatch(/export\s+async\s+function\s+syncNannyVerificationState/);
  });

  it("the sync lives in a module that is not a server-action file", () => {
    const source = readFileSync(resolve(__dirname, "../verification-sync.ts"), "utf8");
    expect(source).toMatch(/export async function syncNannyVerificationState\(userId: string\)/);
    expect(source).not.toMatch(/^\s*["']use server["']/m);
  });
});
