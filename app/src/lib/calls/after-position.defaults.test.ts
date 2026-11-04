/**
 * after-position.ts's default dependencies (04b rework W8, W11): the nanny check reads her placement and this
 * position's confirmed connections as her; the booking holds then confirms as the session's parent, the hold id as the
 * idempotency key. Each failure path answers "couldn't tell" / "not booked" — never a throw into the position save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ placement: vi.fn(), connections: vi.fn(), session: vi.fn(), hold: vi.fn(), confirm: vi.fn() }));
vi.mock("@/lib/actions/position-funnel", () => ({ getParentPlacement: h.placement, getConfirmedConnections: h.connections }));
vi.mock("./parent-session", () => ({ sessionParentId: h.session }));
vi.mock("./parent-booking", () => ({ parentHoldSlot: h.hold, parentConfirmHold: h.confirm }));

import { redirectAfterPosition } from "./after-position";

const POSITION = "d0400000-0000-4000-8000-000000000001";
const HER = "b0400000-0000-4000-8000-000000000001";
const AT = "2027-02-09T14:00:00.000Z";

beforeEach(() => {
  vi.stubEnv("CALL_BOOKING_ENABLED", "true");
  for (const fn of Object.values(h)) fn.mockReset();
  h.placement.mockResolvedValue({ data: null, error: null });
  h.connections.mockResolvedValue({ data: [], error: null });
  h.session.mockResolvedValue(HER);
  h.hold.mockResolvedValue({ ok: true, value: { bookingId: "hold-1", startsAt: AT, endsAt: AT, holdExpiresAt: AT } });
  h.confirm.mockResolvedValue({ ok: true, value: { kind: "booked", bookingId: "hold-1", startsAt: AT, replay: false } });
});
afterEach(() => vi.unstubAllEnvs());

describe("the default nanny check", () => {
  it("no placement, no confirmed connection → the popup opens; her position's connections are read", async () => {
    expect(await redirectAfterPosition(POSITION)).toBe("/parent?t=childcare&call=open");
    expect(h.connections).toHaveBeenCalledWith(POSITION);
  });

  it("a placement, or a confirmed connection → /parent", async () => {
    h.placement.mockResolvedValueOnce({ data: { id: "pl-1" }, error: null });
    expect(await redirectAfterPosition(POSITION)).toBe("/parent");
    h.connections.mockResolvedValueOnce({ data: [{ connectionId: "c-1" }], error: null });
    expect(await redirectAfterPosition(POSITION)).toBe("/parent");
  });

  it("either read failing → /parent (couldn't tell)", async () => {
    h.placement.mockResolvedValueOnce({ data: null, error: "Not authenticated as parent" });
    expect(await redirectAfterPosition(POSITION)).toBe("/parent");
    h.connections.mockResolvedValueOnce({ data: [], error: "Position not found." });
    expect(await redirectAfterPosition(POSITION)).toBe("/parent");
  });
});

describe("the default booking, as her own session (W11)", () => {
  it("holds then confirms with the hold id as the key → booked", async () => {
    expect(await redirectAfterPosition(POSITION, undefined, AT)).toBe("/parent?t=childcare&call=booked");
    expect(h.hold).toHaveBeenCalledWith(HER, AT);
    expect(h.confirm).toHaveBeenCalledWith(HER, "hold-1", "hold-1");
  });

  it("no parent session, a refused hold, or a refused confirm → gone, nothing more attempted", async () => {
    h.session.mockResolvedValueOnce(null);
    expect(await redirectAfterPosition(POSITION, undefined, AT)).toBe(`/parent?t=childcare&call=gone&at=${encodeURIComponent(AT)}`);
    expect(h.hold).not.toHaveBeenCalled();
    h.hold.mockResolvedValueOnce({ ok: false, error: "taken" });
    expect(await redirectAfterPosition(POSITION, undefined, AT)).toContain("call=gone");
    expect(h.confirm).not.toHaveBeenCalled();
    h.confirm.mockResolvedValueOnce({ ok: false, error: "hold_expired" });
    expect(await redirectAfterPosition(POSITION, undefined, AT)).toContain("call=gone");
  });
});
