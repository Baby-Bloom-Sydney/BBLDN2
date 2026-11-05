/**
 * after-position.ts's default dependencies (04b rework W8, W11): the nanny check reads her placement and this
 * position's confirmed connections as her; the booking holds then confirms as the session's parent, the hold id as the
 * idempotency key. Each failure path answers "couldn't tell" / "not booked" — never a throw into the position save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ placement: vi.fn(), connections: vi.fn(), session: vi.fn(), hold: vi.fn(), confirm: vi.fn(), hub: vi.fn() }));
vi.mock("@/lib/actions/position-funnel", () => ({ getParentPlacement: h.placement, getConfirmedConnections: h.connections }));
vi.mock("./parent-session", () => ({ sessionParentId: h.session }));
vi.mock("./parent-booking", () => ({ parentHoldSlot: h.hold, parentConfirmHold: h.confirm }));
vi.mock("./parent-state", () => ({ loadHubCall: h.hub }));

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
  h.hub.mockResolvedValue({ card: null, offered: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("the default nanny check", () => {
  it("no placement, no confirmed connection → the popup opens; her position's connections are read", async () => {
    expect(await redirectAfterPosition(POSITION, { created: true })).toBe("/parent?t=childcare&call=open");
    expect(h.connections).toHaveBeenCalledWith(POSITION);
  });

  it("a placement, or a confirmed connection → no destination", async () => {
    h.placement.mockResolvedValueOnce({ data: { id: "pl-1" }, error: null });
    expect(await redirectAfterPosition(POSITION, { created: true })).toBeUndefined();
    h.connections.mockResolvedValueOnce({ data: [{ connectionId: "c-1" }], error: null });
    expect(await redirectAfterPosition(POSITION, { created: true })).toBeUndefined();
  });

  it("either read failing → no destination (couldn't tell)", async () => {
    h.placement.mockResolvedValueOnce({ data: null, error: "Not authenticated as parent" });
    expect(await redirectAfterPosition(POSITION, { created: true })).toBeUndefined();
    h.connections.mockResolvedValueOnce({ data: [], error: "Position not found." });
    expect(await redirectAfterPosition(POSITION, { created: true })).toBeUndefined();
  });

  it("the offer is the card's rule, for her session (TS review)", async () => {
    h.hub.mockResolvedValueOnce({ card: null, offered: false });
    expect(await redirectAfterPosition(POSITION, { created: true })).toBeUndefined();
    expect(h.hub).toHaveBeenCalledWith(HER);
    h.session.mockResolvedValueOnce(null);
    expect(await redirectAfterPosition(POSITION, { created: true })).toBeUndefined();
  });
});

describe("the default booking, as her own session (W11)", () => {
  it("holds then confirms with the hold id as the key → booked", async () => {
    expect(await redirectAfterPosition(POSITION, { created: true, callAt: AT })).toBe("/parent?t=childcare&call=booked");
    expect(h.hold).toHaveBeenCalledWith(HER, AT);
    expect(h.confirm).toHaveBeenCalledWith(HER, "hold-1", "hold-1");
  });

  it.each([
    ["the hold taken", { hold: { ok: false, error: "taken" } }, "call=gone"],
    ["the hold overlapping", { hold: { ok: false, error: "overlap" } }, "call=gone"],
    ["the confirm taken", { confirm: { ok: false, error: "taken" } }, "call=gone"],
    ["the hold too soon", { hold: { ok: false, error: "too_soon" } }, "call=open&failed=1"],
    ["the hold rate-limited", { hold: { ok: false, error: "rate_limited" } }, "call=open&failed=1"],
    ["the hold invalid", { hold: { ok: false, error: "invalid" } }, "call=open&failed=1"],
    ["the confirm run out", { confirm: { ok: false, error: "hold_expired" } }, "call=open&failed=1"],
    ["a database error", { confirm: { ok: false, error: "error" } }, "call=open&failed=1"],
  ])("%s → %s (only taken says someone else booked it)", async (_why, over, expected) => {
    if ("hold" in over) h.hold.mockResolvedValueOnce(over.hold);
    if ("confirm" in over) h.confirm.mockResolvedValueOnce(over.confirm);
    expect(await redirectAfterPosition(POSITION, { created: true, callAt: AT })).toContain(expected);
  });

  it("no parent session for the booking → the picker open with the line, nothing held", async () => {
    h.session.mockResolvedValueOnce(HER).mockResolvedValueOnce(null);
    expect(await redirectAfterPosition(POSITION, { created: true, callAt: AT })).toContain("call=open&failed=1");
    expect(h.hold).not.toHaveBeenCalled();
  });
});
