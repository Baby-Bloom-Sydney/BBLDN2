/**
 * Where she goes after saving her position in the app (brief 04 §0a.3, §0a.6; 04b rework W8, W11, W12; TS review).
 * BAI: "immediately after creating their position". So the call comes only after a NEW position (or when she picked a
 * time first, W11), only while the card's rule offers it (in scope; not after an answered call or Stop calling), and
 * only with no hired or connected nanny. Otherwise no destination at all (today's `/parent`), with nothing read — an
 * inline edit pays for nothing. Only a taken time says "gone"; any other failure opens the picker with 04b's line.
 * It never throws, so it can never fail the position save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redirectAfterPosition, type AfterPositionDeps, type BookOutcome } from "./after-position";

const POSITION = "d0400000-0000-4000-8000-000000000001";
const AT = "2027-02-09T14:00:00.000Z";

function deps(over: { offered?: boolean | null; nanny?: boolean | null; book?: BookOutcome | Error } = {}) {
  return {
    offered: vi.fn(async () => (over.offered === undefined ? true : over.offered)),
    hasNanny: vi.fn(async () => (over.nanny === undefined ? false : over.nanny)),
    book: vi.fn(async () => {
      if (over.book instanceof Error) throw over.book;
      return over.book ?? ("booked" as BookOutcome);
    }),
  } satisfies AfterPositionDeps;
}

beforeEach(() => vi.stubEnv("CALL_BOOKING_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("redirectAfterPosition — when the call comes at all", () => {
  it("flag off → no destination, nothing read", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const d = deps();
    expect(await redirectAfterPosition(POSITION, { created: true, callAt: AT }, d)).toBeUndefined();
    expect(d.offered).not.toHaveBeenCalled();
    expect(d.book).not.toHaveBeenCalled();
  });

  it("an edit (not created, no picked time) → no destination, nothing read (TS review finding 4)", async () => {
    const d = deps();
    expect(await redirectAfterPosition(POSITION, { created: false }, d)).toBeUndefined();
    expect(d.offered).not.toHaveBeenCalled();
    expect(d.hasNanny).not.toHaveBeenCalled();
  });

  it("a new position, offered, no nanny → the popup over her Childcare tab", async () => {
    const d = deps();
    expect(await redirectAfterPosition(POSITION, { created: true }, d)).toBe("/parent?t=childcare&call=open");
    expect(d.hasNanny).toHaveBeenCalledWith(POSITION);
  });

  it.each([
    ["not offered (out of scope, answered, Stop calling)", { offered: false }],
    ["a hired or connected nanny", { nanny: true }],
    ["couldn't tell (the nanny check)", { nanny: null }],
    ["couldn't tell (the offer)", { offered: null }],
  ])("%s → no destination (today's /parent)", async (_why, over) => {
    expect(await redirectAfterPosition(POSITION, { created: true }, deps(over))).toBeUndefined();
  });

  it("a read that throws → no destination, logged by error name only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps();
    d.hasNanny.mockRejectedValueOnce(new TypeError("fetch failed for jane@example.com"));
    expect(await redirectAfterPosition(POSITION, { created: true }, d)).toBeUndefined();
    expect(log).toHaveBeenCalledWith("[calls/after-position] the call check failed", { name: "TypeError" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("jane@example.com");
    log.mockRestore();
  });
});

describe("redirectAfterPosition — a picked time (W11)", () => {
  it("booked → call=booked (even on an edit: she picked it on the slide)", async () => {
    const d = deps();
    expect(await redirectAfterPosition(POSITION, { created: false, callAt: AT }, d)).toBe("/parent?t=childcare&call=booked");
    expect(d.book).toHaveBeenCalledWith(AT);
  });

  it("taken → call=gone with the time (only taken says someone else booked it)", async () => {
    expect(await redirectAfterPosition(POSITION, { created: true, callAt: AT }, deps({ book: "taken" }))).toBe(
      `/parent?t=childcare&call=gone&at=${encodeURIComponent(AT)}`,
    );
  });

  it("any other failure → the picker open with 04b's line, never 'gone'", async () => {
    expect(await redirectAfterPosition(POSITION, { created: true, callAt: AT }, deps({ book: "failed" }))).toBe("/parent?t=childcare&call=open&failed=1");
  });

  it("a booking that throws → the same (logged), never a failed save", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await redirectAfterPosition(POSITION, { created: true, callAt: AT }, deps({ book: new TypeError("x") }))).toBe("/parent?t=childcare&call=open&failed=1");
    expect(log).toHaveBeenCalledWith("[calls/after-position] the booking failed", { name: "TypeError" });
    log.mockRestore();
  });

  it.each([["not-a-time"], ["2027-02-09"], [""]])("a malformed callAt (%s) is ignored: an edit gets nothing, a new position the plain popup", async (raw) => {
    const d = deps();
    expect(await redirectAfterPosition(POSITION, { created: false, callAt: raw }, d)).toBeUndefined();
    expect(await redirectAfterPosition(POSITION, { created: true, callAt: raw }, d)).toBe("/parent?t=childcare&call=open");
    expect(d.book).not.toHaveBeenCalled();
  });

  it.each([
    ["the offer couldn't be read", { offered: null }],
    ["the nanny check couldn't be read", { nanny: null }],
  ])("W17: %s → her time isn't dropped: the picker open with 04b's line (failed=1); nothing booked", async (_why, over) => {
    const d = deps(over);
    expect(await redirectAfterPosition(POSITION, { created: true, callAt: AT }, d)).toBe("/parent?t=childcare&call=open&failed=1");
    expect(d.book).not.toHaveBeenCalled();
  });

  it("W17: a check that throws, with a picked time → the same (logged), nothing booked", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps();
    d.offered.mockRejectedValueOnce(new TypeError("x"));
    expect(await redirectAfterPosition(POSITION, { created: false, callAt: AT }, d)).toBe("/parent?t=childcare&call=open&failed=1");
    expect(d.book).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("W17: a definite 'no' outranks a check that couldn't be read → no destination", async () => {
    for (const over of [{ offered: false, nanny: null }, { offered: null, nanny: true }]) {
      expect(await redirectAfterPosition(POSITION, { created: true, callAt: AT }, deps(over))).toBeUndefined();
    }
  });

  it("not offered, or a nanny → nothing booked, no destination", async () => {
    for (const over of [{ offered: false }, { nanny: true }]) {
      const d = deps(over);
      expect(await redirectAfterPosition(POSITION, { created: true, callAt: AT }, d)).toBeUndefined();
      expect(d.book).not.toHaveBeenCalled();
    }
  });
});
