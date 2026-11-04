/**
 * Where she goes after saving her position in the app (brief 04 §0a.3, place 2; 04b rework W8, with W12's
 * destination): flag on and no hired or connected nanny → her Childcare tab with the call popup open
 * (`/parent?t=childcare&call=open`); otherwise `/parent`, as today. Flag off → nothing (the flow keeps today's
 * `/parent`). It never throws, so it can never fail the position save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redirectAfterPosition } from "./after-position";

const POSITION = "d0400000-0000-4000-8000-000000000001";
const deps = (hasNanny: () => Promise<boolean | null>) => ({ hasNanny: vi.fn(hasNanny), book: vi.fn(async () => false) });

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

// ── 04b rework W11 (BAI 2026-11-05, brief §0a.6): a parent with no position picked a time on the call slide, then
//    filled in her position (`/parent/request?callAt=`). After the save, as her own session, the time is held then
//    confirmed: booked → the popup says "You're booked"; taken or refused → the popup's picker with the taken notice.
//    A booking failure never fails the save. A malformed callAt is ignored. ──
describe("redirectAfterPosition with callAt (W11)", () => {
  const CALL_AT = "2027-02-09T14:00:00.000Z";
  const withBook = (book: (at: string) => Promise<boolean>, hasNanny: () => Promise<boolean | null> = async () => false) => ({
    hasNanny: vi.fn(hasNanny),
    book: vi.fn(book),
  });

  it("booked → /parent?t=childcare&call=booked", async () => {
    const d = withBook(async () => true);
    expect(await redirectAfterPosition(POSITION, d, CALL_AT)).toBe("/parent?t=childcare&call=booked");
    expect(d.book).toHaveBeenCalledWith(CALL_AT);
  });

  it("taken or refused → the popup's picker with the notice for that time", async () => {
    const d = withBook(async () => false);
    expect(await redirectAfterPosition(POSITION, d, CALL_AT)).toBe(`/parent?t=childcare&call=gone&at=${encodeURIComponent(CALL_AT)}`);
  });

  it("a booking that throws → gone, never a failed save; logged by name only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = withBook(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await redirectAfterPosition(POSITION, d, CALL_AT)).toBe(`/parent?t=childcare&call=gone&at=${encodeURIComponent(CALL_AT)}`);
    expect(log).toHaveBeenCalledWith("[calls/after-position] the booking failed", { name: "TypeError" });
    log.mockRestore();
  });

  it.each([["not-a-time"], ["2027-02-09"], ["2027-02-09T14:00:00"], [""]])("a malformed callAt (%s) is ignored → call=open, nothing booked", async (raw) => {
    const d = withBook(async () => true);
    expect(await redirectAfterPosition(POSITION, d, raw)).toBe("/parent?t=childcare&call=open");
    expect(d.book).not.toHaveBeenCalled();
  });

  it("a hired or connected nanny → /parent, nothing booked", async () => {
    const d = withBook(async () => true, async () => true);
    expect(await redirectAfterPosition(POSITION, d, CALL_AT)).toBe("/parent");
    expect(d.book).not.toHaveBeenCalled();
  });

  it("flag off → undefined, nothing booked", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const d = withBook(async () => true);
    expect(await redirectAfterPosition(POSITION, d, CALL_AT)).toBeUndefined();
    expect(d.book).not.toHaveBeenCalled();
  });
});
