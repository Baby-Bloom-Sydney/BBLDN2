/**
 * Unit 5b (BB-LDN-5b-151026) — the feature hide switches (P-23, Stage 5). `SHARE_LOOP_ENABLED` is off unless the
 * env var is the literal "true" (trimmed); while off, everything the share loop gated counts as unlocked.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { shareLoopEnabled, isShareUnlocked } from "./flags";

afterEach(() => vi.unstubAllEnvs());

describe("shareLoopEnabled()", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["false", "false"],
    ["TRUE (case matters)", "TRUE"],
    ["1", "1"],
    ["typo", "ture"],
  ])("off when %s", (_label, value) => {
    vi.stubEnv("SHARE_LOOP_ENABLED", value as string);
    expect(shareLoopEnabled()).toBe(false);
  });

  it("on only for the literal \"true\" (trimmed)", () => {
    vi.stubEnv("SHARE_LOOP_ENABLED", " true\n");
    expect(shareLoopEnabled()).toBe(true);
  });

  it("is read at call time", () => {
    vi.stubEnv("SHARE_LOOP_ENABLED", "");
    expect(shareLoopEnabled()).toBe(false);
    vi.stubEnv("SHARE_LOOP_ENABLED", "true");
    expect(shareLoopEnabled()).toBe(true);
  });
});

describe("isShareUnlocked() — the shareUnlocked rule", () => {
  it.each([[false], [null], [undefined], [true]])(
    "loop off → unlocked whatever visible_in_bsr is (%s)",
    (visibleInBsr) => {
      vi.stubEnv("SHARE_LOOP_ENABLED", "");
      expect(isShareUnlocked(visibleInBsr)).toBe(true);
    },
  );

  it("loop on → unlocked only when visible_in_bsr is true", () => {
    vi.stubEnv("SHARE_LOOP_ENABLED", "true");
    expect(isShareUnlocked(true)).toBe(true);
    expect(isShareUnlocked(false)).toBe(false);
    expect(isShareUnlocked(null)).toBe(false);
    expect(isShareUnlocked(undefined)).toBe(false);
  });
});
