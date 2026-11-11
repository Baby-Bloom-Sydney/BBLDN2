import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DfyTier } from "@/lib/matching/constants";

const state = vi.hoisted(() => ({
  activateCalls: [] as Array<{
    positionId: string;
    tier: "standard" | "priority";
  }>,
  activateBehaviour: "resolve" as "resolve" | "throw",
}));

vi.mock("@/lib/matching/dfy-dispatch", () => ({
  activateDfyPosition: vi.fn(async (positionId: string, tier: DfyTier) => {
    state.activateCalls.push({ positionId, tier });
    if (state.activateBehaviour === "throw") {
      throw new Error("synthetic activation failure");
    }
  }),
}));

import { autofireMatchmaking } from "./autofire-matchmaking";

describe("autofireMatchmaking", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    state.activateCalls = [];
    state.activateBehaviour = "resolve";
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it("calls activateDfyPosition at priority tier with the supplied positionId", async () => {
    await autofireMatchmaking("pos-123");

    expect(state.activateCalls).toEqual([
      { positionId: "pos-123", tier: "priority" },
    ]);
  });

  it("swallows errors so a failed blast never fails the calling write path", async () => {
    state.activateBehaviour = "throw";

    await expect(autofireMatchmaking("pos-fail")).resolves.toBeUndefined();
    expect(state.activateCalls).toEqual([
      { positionId: "pos-fail", tier: "priority" },
    ]);
  });

  it("logs the failure with the positionId so post-hoc reconciliation is possible", async () => {
    state.activateBehaviour = "throw";

    await autofireMatchmaking("pos-log");

    expect(errSpy).toHaveBeenCalledTimes(1);
    const allArgs = errSpy.mock.calls.flat();
    expect(allArgs).toContain("pos-log");
  });
});
