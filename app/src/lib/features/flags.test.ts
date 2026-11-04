/**
 * Unit 5b (BB-LDN-5b-151026) — the feature hide switches (P-23, Stage 5). `SHARE_LOOP_ENABLED` is off unless the
 * env var is the literal "true" (trimmed); while off, everything the share loop gated counts as unlocked.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { shareLoopEnabled, isShareUnlocked, babysittingEnabled, callBookingEnabled, cohortsEnabled } from "./flags";
// Brief 06 (BB-wave1-041126/06a-build): its own import line, so later briefs add theirs without a merge conflict.
import { nannyInvoicesEnabled } from "./flags";

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

// Unit 5c (BB-LDN-5c-151026) — the babysitting line (Stage 5 ruling 1, N-1).
describe("babysittingEnabled()", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["false", "false"],
    ["TRUE (case matters)", "TRUE"],
    ["1", "1"],
  ])("off when %s", (_label, value) => {
    vi.stubEnv("BABYSITTING_ENABLED", value as string);
    expect(babysittingEnabled()).toBe(false);
  });

  it("on only for the literal \"true\" (trimmed), read at call time", () => {
    vi.stubEnv("BABYSITTING_ENABLED", "");
    expect(babysittingEnabled()).toBe(false);
    vi.stubEnv("BABYSITTING_ENABLED", " true\n");
    expect(babysittingEnabled()).toBe(true);
  });

  it("is independent of the share-loop switch", () => {
    vi.stubEnv("SHARE_LOOP_ENABLED", "true");
    vi.stubEnv("BABYSITTING_ENABLED", "");
    expect(babysittingEnabled()).toBe(false);
  });
});

describe("callBookingEnabled() — brief 04 (CALL_BOOKING_ENABLED)", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["false", "false"],
    ["TRUE (case matters)", "TRUE"],
    ["1", "1"],
    ["a typo", "ture"],
  ])("off when %s", (_label, value) => {
    vi.stubEnv("CALL_BOOKING_ENABLED", value as string);
    expect(callBookingEnabled()).toBe(false);
  });

  it("on only for the literal \"true\" (trimmed), read at call time", () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    expect(callBookingEnabled()).toBe(false);
    vi.stubEnv("CALL_BOOKING_ENABLED", " true\n");
    expect(callBookingEnabled()).toBe(true);
  });

  it("is independent of the other switches", () => {
    vi.stubEnv("BABYSITTING_ENABLED", "true");
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    expect(callBookingEnabled()).toBe(false);
  });
});

describe("cohortsEnabled() — brief 02 (COHORTS_ENABLED)", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["false", "false"],
    ["TRUE (case matters)", "TRUE"],
    ["1", "1"],
    ["a typo", "ture"],
  ])("off when %s", (_label, value) => {
    vi.stubEnv("COHORTS_ENABLED", value as string);
    expect(cohortsEnabled()).toBe(false);
  });

  it("on only for the literal \"true\" (trimmed), read at call time", () => {
    vi.stubEnv("COHORTS_ENABLED", "");
    expect(cohortsEnabled()).toBe(false);
    vi.stubEnv("COHORTS_ENABLED", " true\n");
    expect(cohortsEnabled()).toBe(true);
  });

  it("is independent of the other switches", () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    vi.stubEnv("COHORTS_ENABLED", "");
    expect(cohortsEnabled()).toBe(false);
  });
});

describe("nannyInvoicesEnabled() — brief 06 (NANNY_INVOICES_ENABLED)", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["false", "false"],
    ["TRUE (case matters)", "TRUE"],
    ["1", "1"],
    ["a typo", "ture"],
  ])("off when %s", (_label, value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value as string);
    expect(nannyInvoicesEnabled()).toBe(false);
  });

  it("on only for the literal \"true\" (trimmed), read at call time", () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    expect(nannyInvoicesEnabled()).toBe(false);
    vi.stubEnv("NANNY_INVOICES_ENABLED", " true\n");
    expect(nannyInvoicesEnabled()).toBe(true);
  });

  it("is independent of the other switches", () => {
    vi.stubEnv("COHORTS_ENABLED", "true");
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    expect(nannyInvoicesEnabled()).toBe(false);
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    vi.stubEnv("COHORTS_ENABLED", "");
    expect(cohortsEnabled()).toBe(false);
    expect(nannyInvoicesEnabled()).toBe(true);
  });
});
