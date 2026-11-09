/**
 * Converting a lead claims it first, in one conditional write: two conversions of the same lead at once make one
 * account; a failed conversion releases the claim. BB-wave1-041126, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, writesTo, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
const createUser = vi.fn();
const claim = vi.hoisted(() => ({ taken: false }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ ...admin.client, from: admin.client.from, auth: { admin: { createUser, deleteUser: vi.fn(async () => ({ error: null })) } } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { signInWithPassword: async () => ({ error: null }) } }),
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));

import { convertLeadToAccount } from "./nanny-leads";

const LEAD = { id: "lead-1", first_name: "nina", last_name: "walker", email: "nina@example.test", phone: null };
const isClaim = (op: Op) =>
  op.kind === "update" && (op.payload as Record<string, unknown>)?.converted_at !== undefined
  && (op.payload as Record<string, unknown>)?.lead_status === undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
  claim.taken = false;
  createUser.mockReset().mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 5));
    return { data: { user: { id: "user-new" } }, error: null };
  });
  admin = fakeAdmin({ nanny_leads: LEAD });
  admin.writeResults.nannies = { id: "nanny-new" };
  admin.writeResults.nanny_leads = (op: Op) => {
    if (!isClaim(op) || (op.payload as { converted_at: unknown }).converted_at === null) return null;
    if (claim.taken) return [];
    claim.taken = true;
    return [{ id: "lead-1" }];
  };
});
afterEach(() => vi.useRealTimers());

describe("convertLeadToAccount — the claim", () => {
  it("two conversions of one lead at once make one account", async () => {
    const results = await Promise.all([convertLeadToAccount("lead-1", "pw-123456"), convertLeadToAccount("lead-1", "pw-123456")]);
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(results.filter((r) => !r.success)).toEqual([
      { success: false, error: "An account with this email already exists. Please sign in instead." },
    ]);
  });

  it("claims with one conditional write: no account yet, not converted, no live claim", async () => {
    await convertLeadToAccount("lead-1", "pw-123456");
    const first = writesTo(admin, "nanny_leads")[0];
    expect(isClaim(first!)).toBe(true);
    expect(first?.filters).toEqual(expect.arrayContaining([
      ["eq", "id", "lead-1"], ["is", "auth_user_id", null], ["neq", "lead_status", "converted"],
      ["or", "converted_at.is.null,converted_at.lt.2026-11-09T11:50:00.000Z", undefined],
    ]));
  });

  it("releases the claim when the account can't be made", async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { message: "boom" } });
    expect((await convertLeadToAccount("lead-1", "pw-123456")).success).toBe(false);
    const release = writesTo(admin, "nanny_leads").at(-1);
    expect(release?.payload).toEqual({ converted_at: null });
    expect(release?.filters).toEqual([["eq", "id", "lead-1"], ["is", "auth_user_id", null]]);
  });
});
