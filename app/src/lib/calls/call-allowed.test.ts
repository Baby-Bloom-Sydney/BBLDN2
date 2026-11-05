/**
 * The one rule for "may she hold or confirm a call time now" (04b rework W17, final review item 12), shared by the
 * hold and confirm actions: the card's rule (in scope; not after an answered call or Stop calling), or a booked call
 * still ahead (she is changing it — the card shows it, offered or not), and no hired or connected nanny. A read that
 * fails, or throws, is "unknown" (the action refuses with the generic code), never a guess either way.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/position-funnel", () => ({ getParentPlacement: vi.fn(), getConfirmedConnections: vi.fn() }));

import { mayBookNow, type MayBookDeps } from "./call-allowed";
import type { HubCall } from "./parent-state";

const HER = "b0400000-0000-4000-8000-000000000001";
const POSITION = "d0400000-0000-4000-8000-000000000001";
const OFFERED: HubCall = { card: { kind: "not_booked", afterNoAnswer: false }, offered: true, failed: false };
const NOT_OFFERED: HubCall = { card: null, offered: false, failed: false };
const UNREADABLE: HubCall = { card: null, offered: false, failed: true };

function deps(over: { hub?: HubCall; position?: string | null | undefined; nanny?: boolean | null } = {}) {
  return {
    hub: vi.fn(async () => over.hub ?? OFFERED),
    latestPosition: vi.fn(async () => ("position" in over ? over.position : POSITION)),
    hasNanny: vi.fn(async () => (over.nanny === undefined ? false : over.nanny)),
  } satisfies MayBookDeps;
}

describe("mayBookNow", () => {
  it("offered, no nanny → yes; the nanny check is for her latest position", async () => {
    const d = deps();
    expect(await mayBookNow(HER, d)).toBe("yes");
    expect(d.hub).toHaveBeenCalledWith(HER);
    expect(d.hasNanny).toHaveBeenCalledWith(POSITION);
  });

  it("not offered (out of scope, an answered call, Stop calling) → no", async () => {
    expect(await mayBookNow(HER, deps({ hub: NOT_OFFERED }))).toBe("no");
  });

  it("a booked call still ahead passes even when not offered: she is changing her time", async () => {
    const booked: HubCall = { card: { kind: "booked", line: "Tue 9 Feb, 14:00", changeable: true }, offered: false, failed: false };
    expect(await mayBookNow(HER, deps({ hub: booked }))).toBe("yes");
  });

  it("a booked call already started (not changeable) and not offered → no", async () => {
    const started: HubCall = { card: { kind: "booked", line: "Tue 9 Feb, 14:00", changeable: false }, offered: false, failed: false };
    expect(await mayBookNow(HER, deps({ hub: started }))).toBe("no");
  });

  it("a hired or connected nanny → no, even when offered; with no position only the placement counts", async () => {
    expect(await mayBookNow(HER, deps({ nanny: true }))).toBe("no");
    const d = deps({ position: null });
    expect(await mayBookNow(HER, d)).toBe("yes");
    expect(d.hasNanny).toHaveBeenCalledWith(null);
  });

  it.each([
    ["the hub's read failed", { hub: UNREADABLE }],
    ["her position couldn't be read", { position: undefined }],
    ["the nanny check couldn't tell", { nanny: null }],
  ])("%s → unknown", async (_why, over) => {
    expect(await mayBookNow(HER, deps(over))).toBe("unknown");
  });

  it("a definite no outranks an unknown", async () => {
    expect(await mayBookNow(HER, deps({ hub: NOT_OFFERED, nanny: null }))).toBe("no");
    expect(await mayBookNow(HER, deps({ hub: UNREADABLE, nanny: true }))).toBe("no");
  });

  it("a check that throws → unknown, logged by error name only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps();
    d.hub.mockRejectedValueOnce(new TypeError("fetch failed for jane@example.com"));
    expect(await mayBookNow(HER, d)).toBe("unknown");
    expect(log).toHaveBeenCalledWith("[calls/call-allowed] the call check failed", { name: "TypeError" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("jane@example.com");
    log.mockRestore();
  });
});
