/**
 * Where she goes after saving her position in the app (brief 04 §0a.3, place 2; 04b rework W8, with W12's
 * destination): flag on and no hired or connected nanny → her Childcare tab with the call popup open
 * (`/parent?t=childcare&call=open`); otherwise `/parent`, as today. Flag off → nothing (the flow keeps today's
 * `/parent`). It never throws, so it can never fail the position save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redirectAfterPosition } from "./after-position";

const POSITION = "d0400000-0000-4000-8000-000000000001";
const deps = (hasNanny: () => Promise<boolean | null>) => ({ hasNanny: vi.fn(hasNanny) });

beforeEach(() => vi.stubEnv("CALL_BOOKING_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("redirectAfterPosition", () => {
  it("flag off → undefined, and nothing is read", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const d = deps(async () => false);
    expect(await redirectAfterPosition(POSITION, d)).toBeUndefined();
    expect(d.hasNanny).not.toHaveBeenCalled();
  });

  it("no hired or connected nanny → the Childcare tab with the call popup open", async () => {
    const d = deps(async () => false);
    expect(await redirectAfterPosition(POSITION, d)).toBe("/parent?t=childcare&call=open");
    expect(d.hasNanny).toHaveBeenCalledWith(POSITION);
  });

  it("a hired or connected nanny → /parent, as today", async () => {
    expect(await redirectAfterPosition(POSITION, deps(async () => true))).toBe("/parent");
  });

  it("couldn't tell (a read failed) → /parent, as today", async () => {
    expect(await redirectAfterPosition(POSITION, deps(async () => null))).toBe("/parent");
  });

  it("a throw → /parent, logged by error name only; never thrown on", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps(async () => {
      throw new TypeError("fetch failed for jane@example.com");
    });
    expect(await redirectAfterPosition(POSITION, d)).toBe("/parent");
    expect(log).toHaveBeenCalledWith("[calls/after-position] the nanny check failed", { name: "TypeError" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("jane@example.com");
    log.mockRestore();
  });
});
