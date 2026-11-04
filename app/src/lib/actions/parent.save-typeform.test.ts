/**
 * saveTypeformPosition, after the save (04b rework W8; brief 04 §0a.3). Only the return gains an optional
 * `redirectTo`, decided server-side by `redirectAfterPosition`; nothing else in the save changes, and with the flag
 * off the result is exactly today's (no `redirectTo` key at all).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

const h = vi.hoisted(() => ({ fake: null as unknown as FakeAdmin, after: vi.fn(), autofire: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } }, error: null }) },
    from: (table: string) => h.fake.client.from(table),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.fake.client }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./autofire-matchmaking", () => ({ autofireMatchmaking: h.autofire }));
vi.mock("@/lib/calls/after-position", () => ({ redirectAfterPosition: h.after }));

import { saveTypeformPosition } from "./parent";

const FORM = { num_children: 0, suburb: "Clapham", postcode: "SW4 0AA" };

beforeEach(() => {
  h.fake = fakeAdmin({ parents: { id: "parent-1" }, nanny_positions: null });
  h.fake.writeResults.nanny_positions = { id: "pos-1" };
  h.after.mockReset();
  h.autofire.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("saveTypeformPosition → redirectTo (W8)", () => {
  it("returns the destination decided for her saved position", async () => {
    h.after.mockResolvedValue("/parent?t=childcare&call=open");
    expect(await saveTypeformPosition(FORM)).toEqual({ success: true, error: null, positionId: "pos-1", redirectTo: "/parent?t=childcare&call=open" });
    expect(h.after).toHaveBeenCalledWith("pos-1", undefined, undefined);
    expect(h.autofire).toHaveBeenCalledWith("pos-1");
  });

  it("W11: the time she picked (callAt) is handed on after the save; its outcome is the destination", async () => {
    h.after.mockResolvedValue("/parent?t=childcare&call=booked");
    const result = await saveTypeformPosition(FORM, { callAt: "2027-02-09T14:00:00.000Z" });
    expect(h.after).toHaveBeenCalledWith("pos-1", undefined, "2027-02-09T14:00:00.000Z");
    expect(result).toEqual({ success: true, error: null, positionId: "pos-1", redirectTo: "/parent?t=childcare&call=booked" });
  });

  it("a hand-crafted null options never throws after the save (security review LOW)", async () => {
    h.after.mockResolvedValue(undefined);
    expect(await saveTypeformPosition(FORM, null as unknown as { callAt?: string })).toMatchObject({ success: true, positionId: "pos-1" });
  });

  it("W11: a booking that went wrong never fails the position save", async () => {
    h.after.mockResolvedValue("/parent?t=childcare&call=gone");
    expect(await saveTypeformPosition(FORM, { callAt: "2027-02-09T14:00:00.000Z" })).toMatchObject({ success: true, positionId: "pos-1" });
  });

  it("no destination (flag off) → today's result exactly, no redirectTo key", async () => {
    h.after.mockResolvedValue(undefined);
    const result = await saveTypeformPosition(FORM);
    expect(result).toEqual({ success: true, error: null, positionId: "pos-1" });
    expect("redirectTo" in result).toBe(false);
  });

  it("a failed save never asks where to go", async () => {
    h.fake.writeErrors.nanny_positions = { message: "boom" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await saveTypeformPosition(FORM)).toEqual({ success: false, error: "Failed to create position" });
    expect(h.after).not.toHaveBeenCalled();
  });
});
