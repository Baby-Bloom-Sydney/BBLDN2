/**
 * Unit 3b (BB-LDN-3b-061026) — P-5 (BAI 2026-10-06): the dev copy of the old onboarding wizard is disabled with a note,
 * never deleted. Its route 404s and its file still exists.
 */
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: nav.notFound,
  useRouter: () => ({ push: vi.fn() }),
}));

import Page from "./page";

const FILE = resolve(__dirname, "page.tsx");

describe("bb/test/onboarding-verification (P-5)", () => {
  it("renders the not-found page", () => {
    expect(() => Page()).toThrow("NEXT_NOT_FOUND");
    expect(nav.notFound).toHaveBeenCalledTimes(1);
  });

  it("keeps its file, with the note at the top saying what it was and why it is disabled", () => {
    expect(existsSync(FILE)).toBe(true);
    const head = readFileSync(FILE, "utf8").split("\n").slice(0, 15).join("\n");
    expect(head).toMatch(/dev copy of the original onboarding wizard/);
    expect(head).toMatch(/P-5, 2026-10-06/);
    expect(head).toMatch(/BB-LDN-3b-061026/);
  });
});
