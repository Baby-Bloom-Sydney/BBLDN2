/**
 * The cross-brief surface (plan A9, §7; brief §8): re-exports only, no logic of its own. With the switch off each
 * answers null / `call_booking_disabled` and no database client is ever created.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const { createAdminClient } = vi.hoisted(() => ({
  createAdminClient: vi.fn((): never => {
    throw new Error("no database in this test");
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import * as booking from "./booking";
import * as contracts from "./contracts";
import type { CallsToMake, UtcRange } from "./contracts";
import * as counts from "./counts";
import * as timezone from "@/lib/timezone";
import * as whoNext from "./who-next";

const PARENT = "b0400000-0000-4000-8000-000000000001";
const ADMIN = "a0400000-0000-4000-8000-000000000001";
const DISABLED = { ok: false, error: "call_booking_disabled" };

beforeEach(() => {
  createAdminClient.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("contracts.ts — the names other briefs import", () => {
  it("exports exactly the contract set", () => {
    expect(Object.keys(contracts).sort()).toEqual(
      [
        "bookSlotForParent",
        "confirmHoldForParent",
        "getCallsToMake",
        "getFreeSlots",
        "getPrebookedCallCount",
        "getWhoIsNext",
        "holdSlotForParent",
        "londonWeekRange",
        "recordCallOutcome",
      ].sort(),
    );
  });

  it("re-exports the implementations themselves (no logic of its own)", () => {
    expect(contracts.londonWeekRange).toBe(timezone.londonWeekRange);
    expect(contracts.getCallsToMake).toBe(counts.getCallsToMake);
    expect(contracts.getPrebookedCallCount).toBe(counts.getPrebookedCallCount);
    expect(contracts.getFreeSlots).toBe(booking.getFreeSlots);
    expect(contracts.holdSlotForParent).toBe(booking.holdSlotForParent);
    expect(contracts.confirmHoldForParent).toBe(booking.confirmHoldForParent);
    expect(contracts.bookSlotForParent).toBe(booking.bookSlotForParent);
    expect(contracts.recordCallOutcome).toBe(booking.recordCallOutcome);
    expect(contracts.getWhoIsNext).toBe(whoNext.getWhoIsNext);
  });

  it("pins the shapes 02 relies on (plan §7)", () => {
    expectTypeOf<CallsToMake>().toEqualTypeOf<{ readonly booked: number; readonly notBooked: number }>();
    expectTypeOf<UtcRange>().toEqualTypeOf<{ readonly fromUtc: string; readonly toUtc: string }>();
    expectTypeOf(contracts.getCallsToMake).parameter(0).toEqualTypeOf<UtcRange>();
    expectTypeOf(contracts.getCallsToMake).returns.resolves.toEqualTypeOf<CallsToMake | null>();
    expectTypeOf(contracts.getPrebookedCallCount).returns.resolves.toEqualTypeOf<number | null>();
    expectTypeOf(contracts.londonWeekRange).returns.toEqualTypeOf<UtcRange>();
    expect(contracts.londonWeekRange(new Date("2027-02-04T10:00:00.000Z"))).toEqual({
      fromUtc: "2027-02-01T00:00:00.000Z",
      toUtc: "2027-02-08T00:00:00.000Z",
    });
  });
});

describe.each(["", "false", "TRUE"])("with CALL_BOOKING_ENABLED = %j", (value) => {
  beforeEach(() => vi.stubEnv("CALL_BOOKING_ENABLED", value));

  it("the counts answer null", async () => {
    expect(await contracts.getCallsToMake(contracts.londonWeekRange())).toBeNull();
    expect(await contracts.getPrebookedCallCount("2027-02-08")).toBeNull();
  });

  it("every operation answers call_booking_disabled", async () => {
    const actor = { userId: PARENT, kind: "parent" } as const;
    expect(await contracts.getFreeSlots({ londonDate: "2027-02-08", purpose: "cohort_prebook" })).toEqual(DISABLED);
    expect(await contracts.holdSlotForParent({ parentUserId: PARENT, startsAt: "2027-02-08T10:00:00.000Z", actor })).toEqual(DISABLED);
    expect(await contracts.confirmHoldForParent({ parentUserId: PARENT, holdId: PARENT, idempotencyKey: "k", actor })).toEqual(DISABLED);
    expect(await contracts.bookSlotForParent({ parentUserId: PARENT, startsAt: "2027-02-08T10:00:00.000Z", idempotencyKey: "k", actor })).toEqual(
      DISABLED,
    );
    expect(await contracts.recordCallOutcome({ parentUserId: PARENT, result: "no_answer", actor: { userId: ADMIN } })).toEqual(DISABLED);
    expect(await contracts.getWhoIsNext()).toEqual(DISABLED);
  });

  it("no database client is created", async () => {
    await contracts.getCallsToMake(contracts.londonWeekRange());
    await contracts.getWhoIsNext();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("with the switch on, the defaults reach the database (and fail closed without one)", () => {
  it("getCallsToMake → null, logged, when no database can be reached", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await contracts.getCallsToMake(contracts.londonWeekRange())).toBeNull();
    expect(createAdminClient).toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
