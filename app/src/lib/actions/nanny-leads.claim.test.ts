/**
 * Converting a lead claims it first, in one conditional write to its own claim column: two conversions of the same
 * lead at once make one account; every failed conversion gives its own claim back (and only its own); the final
 * mark must land. BB-wave1-041126, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, writesTo, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
const createUser = vi.fn();
const deleteUser = vi.fn();
const claim = vi.hoisted(() => ({ taken: false, markLands: true }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ ...admin.client, from: admin.client.from, auth: { admin: { createUser, deleteUser } } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { signInWithPassword: async () => ({ error: null }) } }),
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));

import { convertLeadToAccount } from "./nanny-leads";

const NOW = "2026-11-09T12:00:00.000Z";
const LEAD = { id: "lead-1", first_name: "nina", last_name: "walker", email: "nina@example.test", phone: null };
const payloadOf = (op: Op | undefined) => (op?.payload ?? {}) as Record<string, unknown>;
const isClaim = (op: Op) => op.kind === "update" && typeof payloadOf(op).conversion_claimed_at === "string";
const isRelease = (op: Op) => op.kind === "update" && payloadOf(op).conversion_claimed_at === null && payloadOf(op).lead_status === undefined;
const isMark = (op: Op) => op.kind === "update" && payloadOf(op).lead_status === "converted";
const leadWrites = () => writesTo(admin, "nanny_leads");
const RELEASE_FILTERS = [["eq", "id", "lead-1"], ["eq", "conversion_claimed_at", NOW]];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  claim.taken = false;
  claim.markLands = true;
  createUser.mockReset().mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 5));
    return { data: { user: { id: "user-new" } }, error: null };
  });
  deleteUser.mockReset().mockResolvedValue({ error: null });
  admin = fakeAdmin({ nanny_leads: LEAD });
  admin.writeResults.nannies = { id: "nanny-new" };
  admin.writeResults.nanny_leads = (op: Op) => {
    if (isMark(op)) return claim.markLands ? [{ id: "lead-1" }] : [];
    if (!isClaim(op)) return null;
    if (claim.taken) return [];
    claim.taken = true;
    return [{ id: "lead-1" }];
  };
});
afterEach(() => vi.useRealTimers());

describe("convertLeadToAccount — the claim", () => {
  it("a database error at the claim isn't an existing account: a retry message, the error's code logged, nothing made", async () => {
    admin.writeErrors.nanny_leads = { message: "relation error", code: "42703" };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await convertLeadToAccount("lead-1", "pw-123456");
    const lines = logged.mock.calls.map((call) => JSON.stringify(call)).join(" ");
    logged.mockRestore();
    expect(result.success).toBe(false);
    expect(result.error).not.toMatch(/already exists/);
    expect(result.error).toMatch(/try again/i);
    expect(createUser).not.toHaveBeenCalled();
    expect(lines).toMatch(/42703/);
  });

  it("a lead another conversion holds still reads as an existing account", async () => {
    claim.taken = true;
    const result = await convertLeadToAccount("lead-1", "pw-123456");
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/already exists/) });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("two conversions of one lead at once make one account", async () => {
    const results = await Promise.all([convertLeadToAccount("lead-1", "pw-123456"), convertLeadToAccount("lead-1", "pw-123456")]);
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(results.filter((r) => !r.success)).toEqual([
      { success: false, error: "An account with this email already exists. Please sign in instead." },
    ]);
  });

  it("claims in its own column with one conditional write — never the conversion time", async () => {
    await convertLeadToAccount("lead-1", "pw-123456");
    const first = leadWrites()[0];
    expect(payloadOf(first)).toEqual({ conversion_claimed_at: NOW });
    expect(first?.filters).toEqual(expect.arrayContaining([
      ["eq", "id", "lead-1"], ["is", "auth_user_id", null], ["is", "converted_at", null], ["neq", "lead_status", "converted"],
      ["or", "conversion_claimed_at.is.null,conversion_claimed_at.lt.2026-11-09T11:50:00.000Z", undefined],
    ]));
  });

  it("the final mark is scoped to this run's claim and clears it", async () => {
    await convertLeadToAccount("lead-1", "pw-123456");
    const mark = leadWrites().find(isMark);
    expect(payloadOf(mark)).toMatchObject({ lead_status: "converted", auth_user_id: "user-new", conversion_claimed_at: null });
    expect(mark?.filters).toEqual(RELEASE_FILTERS);
  });
});

describe("convertLeadToAccount — every failure gives back this run's claim, and only its own", () => {
  const releasedOwnClaim = () => {
    const release = leadWrites().filter(isRelease).at(-1);
    expect(payloadOf(release)).toEqual({ conversion_claimed_at: null });
    expect(release?.filters).toEqual(RELEASE_FILTERS);
  };

  it("the account can't be made", async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { message: "boom" } });
    expect((await convertLeadToAccount("lead-1", "pw-123456")).success).toBe(false);
    releasedOwnClaim();
  });

  it("making the account throws (the outer path)", async () => {
    createUser.mockRejectedValue(new Error("network"));
    expect((await convertLeadToAccount("lead-1", "pw-123456")).success).toBe(false);
    releasedOwnClaim();
  });

  it("a later write fails and removing the account throws too", async () => {
    admin.writeErrors.user_roles = { message: "insert failed" };
    deleteUser.mockRejectedValue(new Error("auth down"));
    expect((await convertLeadToAccount("lead-1", "pw-123456")).success).toBe(false);
    expect(deleteUser).toHaveBeenCalledWith("user-new");
    releasedOwnClaim();
  });

  it("the final mark doesn't land (another run took the lead): the account is removed and the claim given back", async () => {
    claim.markLands = false;
    expect(await convertLeadToAccount("lead-1", "pw-123456")).toEqual({ success: false, error: "Failed to create account. Please try again." });
    expect(deleteUser).toHaveBeenCalledWith("user-new");
    releasedOwnClaim();
  });
});
